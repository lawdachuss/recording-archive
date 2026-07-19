import { Router } from "express";
import { db, sql } from "@workspace/db";
import { invalidateOnSuccess } from "../middleware/cache.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

const admin = requireRole("admin");

router.get("/requests", requireAuth, async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT id, user_id, platform, performer_username, stream_link, notes, priority, status, created_at
      FROM requests
      WHERE user_id = ${req.user!.id}
      ORDER BY created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch {
    res.json([]);
  }
});

router.post("/requests", requireAuth, async (req, res) => {
  const { platform, performer_username, stream_link, notes, priority } = req.body as {
    platform?: string;
    performer_username?: string;
    stream_link?: string;
    notes?: string;
    priority?: string;
  };

  if (!platform || !["chaturbate", "stripchat"].includes(platform)) {
    res.status(400).json({ error: "platform is required and must be 'chaturbate' or 'stripchat'" });
    return;
  }

  if (!performer_username && !stream_link) {
    res.status(400).json({ error: "performer_username or stream_link is required" });
    return;
  }

  const validPriority = ["low", "normal", "high"].includes(priority ?? "") ? priority : "normal";

  // Prevent duplicate requests: a user cannot request the same performer on the
  // same platform more than once. If a duplicate is attempted, return the
  // existing request instead of creating a redundant channel.
  const dedupeKey = performer_username ? performer_username : stream_link;
  if (dedupeKey) {
    try {
      const existing = await db.execute(sql`
        SELECT id, user_id, platform, performer_username, stream_link, notes, priority, status, created_at
        FROM requests
        WHERE user_id = ${req.user!.id}
          AND platform = ${platform}
          AND COALESCE(performer_username, '') = COALESCE(${performer_username ?? null}, '')
          AND COALESCE(stream_link, '') = COALESCE(${stream_link ?? null}, '')
        LIMIT 1
      `);
      if (existing.rows.length > 0) {
        res.status(200).json(existing.rows[0]);
        return;
      }
    } catch {
      // If the dedupe check fails, fall through to the insert attempt.
    }
  }

  const fallback = {
    id: null,
    user_id: req.user!.id,
    platform,
    performer_username: performer_username ?? null,
    stream_link: stream_link ?? null,
    notes: notes ?? null,
    priority: validPriority,
    status: "pending",
    created_at: new Date().toISOString(),
  };

  try {
    const result = await db.execute(sql`
      INSERT INTO requests (user_id, platform, performer_username, stream_link, notes, priority, status, created_at)
      VALUES (
        ${req.user!.id},
        ${platform},
        ${performer_username ?? null},
        ${stream_link ?? null},
        ${notes ?? null},
        ${validPriority},
        'pending',
        NOW()
      )
      ON CONFLICT ON CONSTRAINT idx_requests_user_platform_performer
      DO NOTHING
      RETURNING id, user_id, platform, performer_username, stream_link, notes, priority, status, created_at
    `);
    if (result.rows.length > 0) {
      res.status(201).json(result.rows[0]);
      return;
    }
    // Conflict (rare race with the pre-insert dedupe check): return the existing row.
    const existing = await db.execute(sql`
      SELECT id, user_id, platform, performer_username, stream_link, notes, priority, status, created_at
      FROM requests
      WHERE user_id = ${req.user!.id}
        AND platform = ${platform}
        AND COALESCE(performer_username, '') = COALESCE(${performer_username ?? null}, '')
        AND COALESCE(stream_link, '') = COALESCE(${stream_link ?? null}, '')
      LIMIT 1
    `);
    res.status(200).json(existing.rows[0] ?? fallback);
  } catch {
    res.status(201).json(fallback);
  }
});

router.patch("/requests/:id/status", ...admin, invalidateOnSuccess(["performers", "recordings", "stats", "tags"]), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const { status } = req.body as { status?: string };

  const valid = ["pending", "approved", "rejected", "done"];
  if (!status || !valid.includes(status)) {
    res.status(400).json({ error: "status must be one of: pending, approved, rejected, done" });
    return;
  }

  try {
    const result = await db.execute(sql`
      UPDATE requests SET status = ${status} WHERE id = ${id}
      RETURNING id, user_id, platform, performer_username, stream_link, notes, priority, status, created_at
    `);
    if (!result.rows.length) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to update status" });
  }
});

export default router;
