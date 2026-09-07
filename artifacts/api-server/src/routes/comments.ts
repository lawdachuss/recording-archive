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

/** Count likes per comment and track which sessions liked each comment. */
async function fetchLikesForComments(commentIds: number[]) {
  const likeCounts = new Map<number, number>();
  const likedBySession = new Map<number, Set<string>>();

  for (let i = 0; i < commentIds.length; i += 1000) {
    const chunk = commentIds.slice(i, i + 1000);
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

    // Fetch every comment for this recording (PostgREST caps rows at 1,000 per
    // request, so paginate). Tree structure + like-based ordering need the full
    // set before we can slice a page.
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
    const rawPage = req.query.page as string | undefined;
    const rawLimit = req.query.limit as string | undefined;
    const hasPagination = rawPage !== undefined && rawLimit !== undefined;
    const page = hasPagination ? Math.max(1, parseInt(rawPage) || 1) : 1;
    const limit = hasPagination ? Math.min(100, Math.max(1, parseInt(rawLimit) || 50)) : total || 50;
    const totalPages = hasPagination ? Math.ceil(total / limit) || 1 : 1;

    // Like counts (global — the "top" sort ranks by total likes across the
    // recording, not just within the page window).
    const commentIds = allRows.map((r) => Number(r.id));
    const { likeCounts, likedBySession } = await fetchLikesForComments(commentIds);

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

    const offset = (page - 1) * limit;
    const windowRows = allRows.slice(offset, offset + limit).map((r) => ({
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
