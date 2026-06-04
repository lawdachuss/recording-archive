import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

function buildCommentTree(rows: any[], likedSet?: Set<number>): any[] {
  const map = new Map<number, any>();
  const roots: any[] = [];

  for (const row of rows) {
    map.set(Number(row.id), {
      id: Number(row.id),
      recording_id: row.recording_id,
      parent_id: row.parent_id != null ? Number(row.parent_id) : null,
      author: row.deleted ? "[deleted]" : row.author,
      content: row.deleted ? "[comment removed]" : row.content,
      deleted: row.deleted ?? false,
      likes: Number(row.likes ?? 0),
      user_liked: likedSet ? likedSet.has(Number(row.id)) : false,
      created_at: row.created_at,
      replies: [] as any[],
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

router.get("/comments", async (req, res) => {
  const { recording_id, sort = "new", session_id } = req.query as Record<string, string>;

  if (!recording_id) {
    res.status(400).json({ error: "recording_id is required" });
    return;
  }

  let orderClause: string;
  if (sort === "top") orderClause = "likes_count DESC, c.created_at DESC";
  else if (sort === "old") orderClause = "c.created_at ASC";
  else orderClause = "c.created_at DESC";

  const result = await db.execute(sql`
    SELECT
      c.id, c.recording_id, c.parent_id, c.author, c.content, c.deleted, c.created_at,
      COUNT(cl.id) AS likes
    FROM comments c
    LEFT JOIN comment_likes cl ON cl.comment_id = c.id
    WHERE c.recording_id = ${recording_id}
    GROUP BY c.id
    ORDER BY c.parent_id NULLS FIRST, c.created_at DESC
  `);

  const rows = result.rows as any[];

  let likedSet: Set<number> | undefined;
  if (session_id && rows.length > 0) {
    const commentIds = rows.map((r) => Number(r.id));
    const liked = await db.execute(sql`
      SELECT comment_id FROM comment_likes
      WHERE comment_id = ANY(${commentIds}::int[]) AND session_id = ${session_id}
    `);
    likedSet = new Set((liked.rows as any[]).map((r) => Number(r.comment_id)));
  }

  const tree = buildCommentTree(rows, likedSet);
  res.json(tree);
});

router.post("/comments", async (req, res) => {
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

  const row = result.rows[0] as any;
  res.status(201).json({ ...row, likes: 0, user_liked: false, replies: [] });
});

router.post("/comments/:commentId/replies", async (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
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
  const parent = parentResult.rows[0] as any;

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

  const row = result.rows[0] as any;
  res.status(201).json({ ...row, likes: 0, user_liked: false, replies: [] });
});

router.post("/comments/:commentId/like", async (req, res) => {
  const commentId = parseInt(req.params.commentId, 10);
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

  res.json({
    likes: Number((countResult.rows[0] as any)?.likes ?? 0),
    liked: existing.rows.length === 0,
  });
});

export default router;
