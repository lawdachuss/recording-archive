import { Router } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache, invalidateOnSuccess } from "../middleware/cache.js";

interface CommentRow {
  id: number;
  recording_id: string;
  parent_id: number | null;
  author: string;
  content: string;
  deleted: boolean | null;
  created_at: string;
  likes: number;
}

interface CommentNode {
  id: number;
  recording_id: string;
  parent_id: number | null;
  author: string;
  content: string;
  deleted: boolean;
  likes: number;
  user_liked: boolean;
  created_at: string;
  replies: CommentNode[];
}

interface ParentRow {
  id: number;
  recording_id: string;
  parent_id: number | null;
}

function buildCommentTree(rows: CommentRow[], likedSet?: Set<number>): CommentNode[] {
  const map = new Map<number, CommentNode>();
  const roots: CommentNode[] = [];

  for (const row of rows) {
    const id = Number(row.id);
    map.set(id, {
      id,
      recording_id: row.recording_id,
      parent_id: row.parent_id != null ? Number(row.parent_id) : null,
      author: row.deleted ? "[deleted]" : row.author,
      content: row.deleted ? "[comment removed]" : row.content,
      deleted: row.deleted ?? false,
      likes: Number(row.likes ?? 0),
      user_liked: likedSet ? likedSet.has(id) : false,
      created_at: row.created_at,
      replies: [],
    });
  }

  for (const row of rows) {
    const node = map.get(Number(row.id))!;
    const parentId = row.parent_id != null ? Number(row.parent_id) : null;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.replies.push(node);
    } else {
      // Either a root comment (parentId is null) or an orphan reply
      // (parentId references a comment not in this paginated result set).
      // Promote orphans to roots so they aren't silently dropped.
      roots.push(node);
    }
  }

  return roots;
}

/** Count likes per comment and track whether the supplied session liked it. */
async function fetchLikesForComments(commentIds: number[], sessionId?: string) {
  const likeCounts = new Map<number, number>();
  const likedBySession = new Map<number, Set<string>>();

  for (let i = 0; i < commentIds.length; i += 1000) {
    const chunk = commentIds.slice(i, i + 1000);
    const { data: aggregateRows, error: aggregateError } = await supabase.rpc(
      "get_comment_like_stats",
      { p_comment_ids: chunk, p_session_id: sessionId ?? null },
    );

    if (!aggregateError) {
      for (const row of aggregateRows ?? []) {
        const commentId = Number(row.comment_id);
        likeCounts.set(commentId, Number(row.like_count ?? 0));
        if (sessionId && row.user_liked) {
          likedBySession.set(commentId, new Set([sessionId]));
        }
      }
      continue;
    }

    // Compatibility path for databases where migration 020 is not installed.
    const code = (aggregateError as { code?: string }).code;
    const message = (aggregateError as { message?: string }).message ?? "";
    if (code !== "PGRST202" && !/function.*not.*found|Could not find the function/i.test(message)) {
      throw aggregateError;
    }

    const { data, error } = await supabase
      .from("comment_likes")
      .select("comment_id, session_id")
      .in("comment_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      likeCounts.set(r.comment_id, (likeCounts.get(r.comment_id) ?? 0) + 1);
      let sessions = likedBySession.get(r.comment_id);
      if (!sessions) {
        sessions = new Set<string>();
        likedBySession.set(r.comment_id, sessions);
      }
      sessions.add(r.session_id);
    }
  }

  return { likeCounts, likedBySession };
}

const router = Router();

router.get("/comments", cache({ ttlSeconds: 30, staleSeconds: 120, tags: ["comments"] }), async (req, res) => {
  try {
    const { recording_id, sort = "new", session_id } = req.query as Record<string, string>;

    if (!recording_id) {
      res.status(400).json({ error: "recording_id is required" });
      return;
    }

    const rawPage = req.query.page as string | undefined;
    const rawLimit = req.query.limit as string | undefined;
    const hasPagination = rawPage !== undefined && rawLimit !== undefined;
    const page = hasPagination ? Math.max(1, parseInt(rawPage) || 1) : 1;
    const limit = hasPagination ? Math.min(100, Math.max(1, parseInt(rawLimit) || 50)) : 0;
    const offset = hasPagination ? (page - 1) * limit : 0;

    // Fast path: let Postgres sort and paginate before returning comment rows.
    // This keeps the response contract but prevents page requests from shipping
    // every comment and like for a recording to the serverless function.
    const { data: feedData, error: feedError } = await supabase.rpc("get_comment_feed", {
      p_recording_id: recording_id,
      p_sort: sort,
      p_offset: offset,
      p_limit: hasPagination ? limit : null,
      p_session_id: session_id ?? null,
    });

    if (!feedError) {
      const feedRows = (feedData ?? []) as unknown as Array<
        CommentRow & { user_liked?: boolean; total?: number | string }
      >;
      const total = Number(feedRows[0]?.total ?? 0);
      const windowRows = feedRows.map(({ total: _total, user_liked: _userLiked, ...row }) => ({
        ...row,
        likes: Number(row.likes ?? 0),
      }) as CommentRow);
      const likedSet = session_id
        ? new Set(feedRows.filter((row) => row.user_liked).map((row) => Number(row.id)))
        : undefined;
      const tree = buildCommentTree(windowRows, likedSet);

      if (hasPagination) {
        const totalPages = Math.ceil(total / limit) || 1;
        res.json({ data: tree, total, page, limit, totalPages });
      } else {
        // Preserve the legacy flat-array response when page/limit are omitted.
        res.json(tree);
      }
      return;
    }

    const feedErrorCode = (feedError as { code?: string }).code;
    const feedErrorMessage = (feedError as { message?: string }).message ?? "";
    const canUseLegacyPath =
      feedErrorCode === "PGRST202" ||
      feedErrorCode === "42501" ||
      /function.*not.*found|Could not find the function|permission denied/i.test(feedErrorMessage);
    if (!canUseLegacyPath) {
      req.log?.error?.({ err: feedError, recording_id }, "Supabase error fetching paginated comment feed");
      res.status(500).json({ error: "Failed to fetch comments" });
      return;
    }

    // Compatibility fallback for databases before migration 020.
    // Fetch every comment for this recording (PostgREST caps rows at 1,000 per
    // request, so paginate), then preserve the historical tree/sort behavior.
    const { data, error } = await fetchAll((start, end) =>
      supabase
        .from("comments")
        .select("id,recording_id,parent_id,author,content,deleted,created_at")
        .eq("recording_id", recording_id)
        .range(start, end),
    );

    if (error) {
      req.log?.error?.({ err: error, recording_id }, "Supabase error fetching comments");
      res.status(500).json({ error: "Failed to fetch comments" });
      return;
    }

    const allRows = (data ?? []) as CommentRow[];
    const total = allRows.length;

    // Default: return all comments (tree structure requires parent-reply grouping).
    // Only paginate when both page and limit are explicitly passed.
    const limit = hasPagination ? Math.min(100, Math.max(1, parseInt(rawLimit) || 50)) : total || 50;
    const totalPages = hasPagination ? Math.ceil(total / limit) || 1 : 1;

    // Like counts (global — the "top" sort ranks by total likes across the
    // recording, not just within the page window).
    const commentIds = allRows.map((r) => Number(r.id));
    const { likeCounts, likedBySession } = await fetchLikesForComments(commentIds, session_id);

    const likedSet: Set<number> | undefined = session_id
      ? new Set(commentIds.filter((id) => likedBySession.get(id)?.has(session_id)))
      : undefined;

    // ORDER BY parent_id NULLS FIRST + sort key (mirrors the old SQL ordering).
    allRows.sort((a, b) => {
      const pa = a.parent_id == null ? 0 : 1;
      const pb = b.parent_id == null ? 0 : 1;
      if (pa !== pb) return pa - pb;

      if (sort === "top") {
        const la = likeCounts.get(Number(a.id)) ?? 0;
        const lb = likeCounts.get(Number(b.id)) ?? 0;
        if (la !== lb) return lb - la;
      }

      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      if (ta !== tb) return sort === "old" ? ta - tb : tb - ta;
      return 0;
    });

    const fallbackOffset = (page - 1) * limit;
    const windowRows = allRows.slice(fallbackOffset, fallbackOffset + limit).map((r) => ({
      ...r,
      likes: likeCounts.get(Number(r.id)) ?? 0,
    }));

    const tree = buildCommentTree(windowRows, likedSet);
    if (hasPagination) {
      res.json({ data: tree, total, page, limit, totalPages });
    } else {
      // Return flat array for backward compatibility with generated hook type
      res.json(tree);
    }
  } catch (err) {
    req.log?.error?.({ err, recording_id: req.query.recording_id }, "GET /comments unexpected error");
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.post("/comments", invalidateOnSuccess(["comments", "stats"]), async (req, res) => {
  try {
    const { recording_id, author, content, session_id } = req.body as {
      recording_id: string;
      author: string;
      content: string;
      session_id: string;
    };

    if (!recording_id || !content?.trim() || !session_id) {
      res.status(400).json({ error: "recording_id, content, and session_id are required" });
      return;
    }

    const safeAuthor = (author?.trim() || "Anonymous").slice(0, 100);
    const safeContent = content.trim().slice(0, 5000);

    const { data: row, error } = await supabase
      .from("comments")
      .insert({ recording_id, author: safeAuthor, content: safeContent, session_id })
      .select("id,recording_id,parent_id,author,content,deleted,created_at")
      .single();

    if (error) {
      req.log?.error?.({ err: error }, "Supabase error inserting comment");
      res.status(500).json({ error: "Failed to post comment" });
      return;
    }

    res.status(201).json({ ...row, likes: 0, user_liked: false, replies: [] });
  } catch (err) {
    req.log?.error?.({ err }, "POST /comments unexpected error");
    res.status(500).json({ error: "Failed to post comment" });
  }
});

router.post("/comments/:commentId/replies", invalidateOnSuccess(["comments", "stats"]), async (req, res) => {
  try {
    const commentId = parseInt(String(req.params.commentId), 10);
    const { author, content, session_id } = req.body as {
      author: string;
      content: string;
      session_id: string;
    };

    if (isNaN(commentId) || !content?.trim() || !session_id) {
      res.status(400).json({ error: "Valid commentId, content, and session_id are required" });
      return;
    }

    const { data: parent, error: parentError } = await supabase
      .from("comments")
      .select("id,recording_id,parent_id")
      .eq("id", commentId)
      .maybeSingle();

    if (parentError) {
      req.log?.error?.({ err: parentError }, "Supabase error fetching parent comment");
      res.status(500).json({ error: "Failed to post reply" });
      return;
    }
    if (!parent) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const parentRow = parent as unknown as ParentRow;
    const rootId = parentRow.parent_id != null ? Number(parentRow.parent_id) : commentId;
    const safeAuthor = (author?.trim() || "Anonymous").slice(0, 100);
    const safeContent = content.trim().slice(0, 5000);

    const { data: row, error } = await supabase
      .from("comments")
      .insert({ recording_id: parentRow.recording_id, parent_id: rootId, author: safeAuthor, content: safeContent, session_id })
      .select("id,recording_id,parent_id,author,content,deleted,created_at")
      .single();

    if (error) {
      req.log?.error?.({ err: error }, "Supabase error inserting reply");
      res.status(500).json({ error: "Failed to post reply" });
      return;
    }

    res.status(201).json({ ...row, likes: 0, user_liked: false, replies: [] });
  } catch (err) {
    req.log?.error?.({ err }, "POST /comments/:commentId/replies unexpected error");
    res.status(500).json({ error: "Failed to post reply" });
  }
});

router.post("/comments/:commentId/like", invalidateOnSuccess(["comments"]), async (req, res) => {
  try {
    const commentId = parseInt(String(req.params.commentId), 10);
    const { session_id } = req.body as { session_id: string };

    if (isNaN(commentId) || !session_id) {
      res.status(400).json({ error: "Valid commentId and session_id are required" });
      return;
    }

    const { data: existing } = await supabase
      .from("comment_likes")
      .select("id")
      .eq("comment_id", commentId)
      .eq("session_id", session_id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("session_id", session_id);
      if (error) {
        req.log?.error?.({ err: error }, "Supabase error unliking comment");
        res.status(500).json({ error: "Failed to update like" });
        return;
      }
    } else {
      const { error } = await supabase.from("comment_likes").insert({ comment_id: commentId, session_id });
      if (error && error.code !== "23505") {
        req.log?.error?.({ err: error }, "Supabase error liking comment");
        res.status(500).json({ error: "Failed to update like" });
        return;
      }
    }

    const { count, error: countError } = await supabase
      .from("comment_likes")
      .select("id", { count: "exact", head: true })
      .eq("comment_id", commentId);

    if (countError) {
      req.log?.error?.({ err: countError }, "Supabase error counting comment likes");
      res.status(500).json({ error: "Failed to update like" });
      return;
    }

    res.json({
      likes: count ?? 0,
      liked: !existing,
    });
  } catch (err) {
    req.log?.error?.({ err }, "POST /comments/:commentId/like unexpected error");
    res.status(500).json({ error: "Failed to update like" });
  }
});

export default router;
