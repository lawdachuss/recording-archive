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
  //
  // NOTE: The database has a UNIQUE INDEX (not a named CONSTRAINT) on
  // (user_id, platform, COALESCE(performer_username,''), COALESCE(stream_link,'')),
  // so we cannot use ON CONFLICT ON CONSTRAINT. Instead we rely on the pre-insert
  // dedupe check + the UNIQUE INDEX to catch race conditions, with a fallback
  // that looks up the existing row in the error path.
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

  try {
    // Simple INSERT without ON CONFLICT — the unique index handles duplicate
    // rejection, and we catch unique-violation errors in the catch block below.
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
      RETURNING id, user_id, platform, performer_username, stream_link, notes, priority, status, created_at
    `);

    const created = result.rows[0] as {
      id: number;
      user_id: string;
      platform: string;
      performer_username: string | null;
    };

    // Create a confirmation notification for the requester (if enabled)
    try {
      const [prefRow] = (await db.execute(sql`
        SELECT enabled FROM user_notification_preferences
        WHERE user_id = ${created.user_id} AND notification_type = 'request_submitted'
        LIMIT 1
      `)).rows;
      const enabled = prefRow ? prefRow.enabled : true; // default: enabled
      if (enabled) {
        const performerName = created.performer_username ?? "a performer";
        const message = `Your request for @${performerName} on ${created.platform} has been submitted and is pending review.`;
        await db.execute(sql`
          INSERT INTO user_notifications (user_id, type, message, related_id, is_read, created_at)
          VALUES (
            ${created.user_id},
            'request_submitted',
            ${message},
            ${String(created.id)},
            false,
            NOW()
          )
        `);
      }
    } catch {
      // Non-critical — don't fail the request if notification insert fails
    }

    res.status(201).json(created);
  } catch {
    // Catch: unique-violation from the index, or any other error.
    // Return the existing row if this was a duplicate.
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
      // Fallback lookup also failed — return a proper error.
    }
    res.status(500).json({ error: "Failed to submit request. Please try again." });
  }
});

router.delete("/requests/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid request ID" });
      return;
    }

    const result = await db.execute(sql`
      DELETE FROM requests
      WHERE id = ${id}
        AND user_id = ${req.user!.id}
      RETURNING id
    `);

    if (!result.rows.length) {
      res.status(404).json({ error: "Request not found or not yours to delete" });
      return;
    }

    // Also clean up related notifications
    try {
      await db.execute(sql`
        DELETE FROM user_notifications
        WHERE user_id = ${req.user!.id}
          AND related_id = ${String(id)}
          AND (type = 'request_status' OR type = 'request_submitted')
      `);
    } catch {
      // Non-critical — don't fail the request if notification cleanup fails
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete request" });
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
