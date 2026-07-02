import { Router } from "express";
import { db, sql } from "@workspace/db";
import { invalidateOnSuccess } from "../middleware/cache";

interface CommentRow {
  id: string;
  recording_id: string;
  parent_id: string | null;
  author: string;
  content: string;
  deleted: boolean | null;
  created_at: string;
  likes: string;
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
  id: string;
  recording_id: string;
  parent_id: string | null;
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
    } else if (!parentId) {
      roots.push(node);
    }
  }

  return roots;
}

const router = Router();

router.get("/comments", async (req, res) => {
  const { recording_id, sort = "new", session_id } = req.query as Record<string, string>;

  if (!recording_id) {
    res.status(400).json({ error: "recording_id is required" });
    return;
  }

  // Count total comments for this recording
  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS total FROM comments WHERE recording_id = ${recording_id}
  `);
  const countRow = countResult.rows[0] as { total: number } | undefined;
  const total = Number(countRow?.total ?? 0);

  // Default: return all comments (tree structure requires parent-reply grouping).
  // Only paginate when both page and limit are explicitly passed.
  const rawPage = req.query.page as string | undefined;
  const rawLimit = req.query.limit as string | undefined;
  const hasPagination = rawPage !== undefined && rawLimit !== undefined;
  const page = hasPagination ? Math.max(1, parseInt(rawPage) || 1) : 1;
  const limit = hasPagination ? Math.min(100, Math.max(1, parseInt(rawLimit) || 50)) : total || 50;
  const totalPages = hasPagination ? Math.ceil(total / limit) || 1 : 1;

  const offset = (page - 1) * limit;

  // ORDER BY parent_id NULLS FIRST ensures root comments come before their
  // replies, preserving tree structure for buildCommentTree. When paginated,
  // this means some replies may be separated from their parent, but the
  // tree builder handles orphans by promoting them to roots.
  const result = await db.execute(sql`
    SELECT
      c.id, c.recording_id, c.parent_id, c.author, c.content, c.deleted, c.created_at,
      COUNT(cl.id) AS likes
    FROM comments c
    LEFT JOIN comment_likes cl ON cl.comment_id = c.id
    WHERE c.recording_id = ${recording_id}
    GROUP BY c.id
    ORDER BY c.parent_id NULLS FIRST, c.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const rows = result.rows as unknown as CommentRow[];

  let likedSet: Set<number> | undefined;
  if (session_id && rows.length > 0) {
    const commentIds = rows.map((r) => Number(r.id));
    const liked = await db.execute(sql`
      SELECT comment_id FROM comment_likes
      WHERE comment_id = ANY(${commentIds}::int[]) AND session_id = ${session_id}
    `);
    const likedRows = liked.rows as { comment_id: number }[];
    likedSet = new Set(likedRows.map((r) => Number(r.comment_id)));
  }

  const tree = buildCommentTree(rows, likedSet);
  if (hasPagination) {
    res.json({ data: tree, total, page, limit, totalPages });
  } else {
    // Return flat array for backward compatibility with generated hook type
    res.json(tree);
  }
});

router.post("/comments", invalidateOnSuccess(["stats"]), async (req, res) => {
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

  const result = await db.execute(sql`
    INSERT INTO comments (recording_id, author, content, session_id)
    VALUES (${recording_id}, ${safeAuthor}, ${safeContent}, ${session_id})
    RETURNING id, recording_id, parent_id, author, content, deleted, created_at
  `);

  const row = result.rows[0] as Omit<CommentRow, "likes"> | undefined;
  res.status(201).json({ ...row, likes: 0, user_liked: false, replies: [] });
});

router.post("/comments/:commentId/replies", invalidateOnSuccess(["stats"]), async (req, res) => {
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

  const parentResult = await db.execute(sql`
    SELECT id, recording_id, parent_id FROM comments WHERE id = ${commentId}
  `);
  const parent = parentResult.rows[0] as unknown as ParentRow | undefined;

  if (!parent) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const rootId = parent.parent_id != null ? Number(parent.parent_id) : commentId;
  const safeAuthor = (author?.trim() || "Anonymous").slice(0, 100);
  const safeContent = content.trim().slice(0, 5000);

  const result = await db.execute(sql`
    INSERT INTO comments (recording_id, parent_id, author, content, session_id)
    VALUES (${parent.recording_id}, ${rootId}, ${safeAuthor}, ${safeContent}, ${session_id})
    RETURNING id, recording_id, parent_id, author, content, deleted, created_at
  `);

  const row = result.rows[0] as Omit<CommentRow, "likes"> | undefined;
  res.status(201).json({ ...row, likes: 0, user_liked: false, replies: [] });
});

router.post("/comments/:commentId/like", async (req, res) => {
  const commentId = parseInt(String(req.params.commentId), 10);
  const { session_id } = req.body as { session_id: string };

  if (isNaN(commentId) || !session_id) {
    res.status(400).json({ error: "Valid commentId and session_id are required" });
    return;
  }

  const existing = await db.execute(sql`
    SELECT id FROM comment_likes
    WHERE comment_id = ${commentId} AND session_id = ${session_id}
  `);

  if (existing.rows.length > 0) {
    await db.execute(sql`
      DELETE FROM comment_likes
      WHERE comment_id = ${commentId} AND session_id = ${session_id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO comment_likes (comment_id, session_id)
      VALUES (${commentId}, ${session_id})
      ON CONFLICT DO NOTHING
    `);
  }

  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS likes FROM comment_likes WHERE comment_id = ${commentId}
  `);
  const countRow = countResult.rows[0] as { likes: number } | undefined;

  res.json({
    likes: Number(countRow?.likes ?? 0),
    liked: existing.rows.length === 0,
  });
});

export default router;
