import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use("/user", requireAuth);

// ─── Profile ─────────────────────────────────────────────────────────────────

router.get("/user/profile", async (req, res) => {
  const userId = req.user!.id;
  const result = await db.execute(sql`
    SELECT user_id, display_name, avatar_url, bio, created_at, updated_at
    FROM user_profiles WHERE user_id = ${userId}
  `);
  if (!result.rows.length) {
    const name = req.user!.email?.split("@")[0] ?? "User";
    const created = await db.execute(sql`
      INSERT INTO user_profiles (user_id, display_name, created_at, updated_at)
      VALUES (${userId}, ${name}, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      RETURNING user_id, display_name, avatar_url, bio, created_at, updated_at
    `);
    res.json(created.rows[0] ?? { user_id: userId, display_name: name });
    return;
  }
  res.json(result.rows[0]);
});

router.put("/user/profile", async (req, res) => {
  const userId = req.user!.id;
  const { display_name, avatar_url, bio } = req.body as {
    display_name?: string;
    avatar_url?: string;
    bio?: string;
  };
  await db.execute(sql`
    INSERT INTO user_profiles (user_id, display_name, avatar_url, bio, created_at, updated_at)
    VALUES (${userId}, ${display_name ?? null}, ${avatar_url ?? null}, ${bio ?? null}, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = COALESCE(${display_name ?? null}, user_profiles.display_name),
      avatar_url = ${avatar_url !== undefined ? (avatar_url ?? null) : sql`user_profiles.avatar_url`},
      bio = ${bio !== undefined ? (bio ?? null) : sql`user_profiles.bio`},
      updated_at = NOW()
  `);
  const result = await db.execute(sql`
    SELECT user_id, display_name, avatar_url, bio, created_at, updated_at
    FROM user_profiles WHERE user_id = ${userId}
  `);
  res.json(result.rows[0]);
});

// ─── Role ─────────────────────────────────────────────────────────────────────

router.get("/user/role", async (req, res) => {
  const userId = req.user!.id;
  const result = await db.execute(sql`
    SELECT role FROM user_roles WHERE user_id = ${userId}
  `);
  res.json({ role: (result.rows[0] as any)?.role ?? "user" });
});

// ─── Saved Videos ─────────────────────────────────────────────────────────────

router.get("/user/saved", async (req, res) => {
  const userId = req.user!.id;
  const result = await db.execute(sql`
    SELECT recording_id, metadata, saved_at
    FROM saved_videos WHERE user_id = ${userId}
    ORDER BY saved_at DESC
  `);
  res.json(result.rows);
});

router.post("/user/saved", async (req, res) => {
  const userId = req.user!.id;
  const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
  if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }
  await db.execute(sql`
    INSERT INTO saved_videos (user_id, recording_id, metadata, saved_at)
    VALUES (${userId}, ${recording_id}, ${metadata ?? null}, NOW())
    ON CONFLICT (user_id, recording_id) DO UPDATE SET metadata = EXCLUDED.metadata
  `);
  res.status(201).json({ ok: true });
});

router.delete("/user/saved/:recordingId", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`
    DELETE FROM saved_videos WHERE user_id = ${userId} AND recording_id = ${req.params.recordingId}
  `);
  res.json({ ok: true });
});

// ─── Watch History ────────────────────────────────────────────────────────────

router.get("/user/history", async (req, res) => {
  const userId = req.user!.id;
  const result = await db.execute(sql`
    SELECT recording_id, metadata, watched_at
    FROM watch_history WHERE user_id = ${userId}
    ORDER BY watched_at DESC LIMIT 200
  `);
  res.json(result.rows);
});

router.post("/user/history", async (req, res) => {
  const userId = req.user!.id;
  const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
  if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }
  await db.execute(sql`
    INSERT INTO watch_history (user_id, recording_id, metadata, watched_at)
    VALUES (${userId}, ${recording_id}, ${metadata ?? null}, NOW())
    ON CONFLICT (user_id, recording_id) DO UPDATE SET watched_at = NOW(), metadata = EXCLUDED.metadata
  `);
  res.status(201).json({ ok: true });
});

router.delete("/user/history", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`DELETE FROM watch_history WHERE user_id = ${userId}`);
  res.json({ ok: true });
});

// ─── Watch Later ──────────────────────────────────────────────────────────────

router.get("/user/watch-later", async (req, res) => {
  const userId = req.user!.id;
  const result = await db.execute(sql`
    SELECT recording_id, metadata, added_at
    FROM watch_later_items WHERE user_id = ${userId}
    ORDER BY added_at ASC
  `);
  res.json(result.rows);
});

router.post("/user/watch-later", async (req, res) => {
  const userId = req.user!.id;
  const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
  if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }
  await db.execute(sql`
    INSERT INTO watch_later_items (user_id, recording_id, metadata, added_at)
    VALUES (${userId}, ${recording_id}, ${metadata ?? null}, NOW())
    ON CONFLICT (user_id, recording_id) DO NOTHING
  `);
  res.status(201).json({ ok: true });
});

router.delete("/user/watch-later/:recordingId", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`
    DELETE FROM watch_later_items WHERE user_id = ${userId} AND recording_id = ${req.params.recordingId}
  `);
  res.json({ ok: true });
});

router.delete("/user/watch-later", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`DELETE FROM watch_later_items WHERE user_id = ${userId}`);
  res.json({ ok: true });
});

// ─── Collections ──────────────────────────────────────────────────────────────

router.get("/user/collections", async (req, res) => {
  const userId = req.user!.id;
  const cols = await db.execute(sql`
    SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
      COUNT(ci.id)::int AS item_count,
      MIN(ci.metadata) AS first_item_metadata
    FROM user_collections c
    LEFT JOIN user_collection_items ci ON ci.collection_id = c.id
    WHERE c.user_id = ${userId}
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);
  res.json(cols.rows);
});

router.post("/user/collections", async (req, res) => {
  const userId = req.user!.id;
  const { name, description } = req.body as { name: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name required" }); return; }
  const id = crypto.randomUUID();
  const result = await db.execute(sql`
    INSERT INTO user_collections (id, user_id, name, description, created_at, updated_at)
    VALUES (${id}, ${userId}, ${name.trim()}, ${description ?? null}, NOW(), NOW())
    RETURNING id, name, description, created_at, updated_at
  `);
  res.status(201).json(result.rows[0]);
});

router.put("/user/collections/:id", async (req, res) => {
  const userId = req.user!.id;
  const { name, description } = req.body as { name?: string; description?: string };
  const result = await db.execute(sql`
    UPDATE user_collections SET
      name = COALESCE(${name ?? null}, name),
      description = ${description !== undefined ? (description ?? null) : sql`description`},
      updated_at = NOW()
    WHERE id = ${req.params.id} AND user_id = ${userId}
    RETURNING id, name, description, created_at, updated_at
  `);
  if (!result.rows.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(result.rows[0]);
});

router.delete("/user/collections/:id", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`DELETE FROM user_collection_items WHERE collection_id = ${req.params.id}`);
  await db.execute(sql`
    DELETE FROM user_collections WHERE id = ${req.params.id} AND user_id = ${userId}
  `);
  res.json({ ok: true });
});

router.get("/user/collections/:id/items", async (req, res) => {
  const userId = req.user!.id;
  const col = await db.execute(sql`
    SELECT id FROM user_collections WHERE id = ${req.params.id} AND user_id = ${userId}
  `);
  if (!col.rows.length) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.execute(sql`
    SELECT recording_id, metadata, added_at
    FROM user_collection_items WHERE collection_id = ${req.params.id}
    ORDER BY added_at DESC
  `);
  res.json(items.rows);
});

router.post("/user/collections/:id/items", async (req, res) => {
  const userId = req.user!.id;
  const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
  if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }
  const col = await db.execute(sql`
    SELECT id FROM user_collections WHERE id = ${req.params.id} AND user_id = ${userId}
  `);
  if (!col.rows.length) { res.status(404).json({ error: "Not found" }); return; }
  await db.execute(sql`
    INSERT INTO user_collection_items (collection_id, recording_id, metadata, added_at)
    VALUES (${req.params.id}, ${recording_id}, ${metadata ?? null}, NOW())
    ON CONFLICT (collection_id, recording_id) DO NOTHING
  `);
  res.status(201).json({ ok: true });
});

router.delete("/user/collections/:id/items/:recordingId", async (req, res) => {
  const userId = req.user!.id;
  const col = await db.execute(sql`
    SELECT id FROM user_collections WHERE id = ${req.params.id} AND user_id = ${userId}
  `);
  if (!col.rows.length) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.execute(sql`
    DELETE FROM user_collection_items
    WHERE collection_id = ${req.params.id} AND recording_id = ${req.params.recordingId}
  `);
  res.json({ ok: true });
});

// ─── Performer Follows ────────────────────────────────────────────────────────

router.get("/user/follows", async (req, res) => {
  const userId = req.user!.id;
  const result = await db.execute(sql`
    SELECT performer_username, followed_at
    FROM performer_follows WHERE user_id = ${userId}
    ORDER BY followed_at DESC
  `);
  res.json(result.rows);
});

router.post("/user/follows", async (req, res) => {
  const userId = req.user!.id;
  const { performer_username } = req.body as { performer_username: string };
  if (!performer_username) { res.status(400).json({ error: "performer_username required" }); return; }
  await db.execute(sql`
    INSERT INTO performer_follows (user_id, performer_username, followed_at)
    VALUES (${userId}, ${performer_username}, NOW())
    ON CONFLICT (user_id, performer_username) DO NOTHING
  `);
  res.status(201).json({ ok: true });
});

router.delete("/user/follows/:username", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`
    DELETE FROM performer_follows
    WHERE user_id = ${userId} AND performer_username = ${req.params.username}
  `);
  res.json({ ok: true });
});

// ─── Notifications ────────────────────────────────────────────────────────────

router.get("/user/notifications", async (req, res) => {
  const userId = req.user!.id;
  const result = await db.execute(sql`
    SELECT id, type, message, related_id, is_read, created_at
    FROM user_notifications WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 50
  `);
  res.json(result.rows);
});

router.put("/user/notifications/read-all", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`UPDATE user_notifications SET is_read = TRUE WHERE user_id = ${userId}`);
  res.json({ ok: true });
});

router.delete("/user/notifications/:id", async (req, res) => {
  const userId = req.user!.id;
  await db.execute(sql`
    DELETE FROM user_notifications WHERE id = ${req.params.id} AND user_id = ${userId}
  `);
  res.json({ ok: true });
});

export default router;
