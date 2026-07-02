import { Router } from "express";
import { db, sql } from "@workspace/db";
import { invalidateOnSuccess } from "../middleware/cache";

const router = Router();

router.get("/requests", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT id, performer_username, stream_link, notes, priority, status, created_at
      FROM requests
      ORDER BY created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch {
    res.json([]);
  }
});

router.post("/requests", async (req, res) => {
  const { performer_username, stream_link, notes, priority } = req.body as {
    performer_username?: string;
    stream_link?: string;
    notes?: string;
    priority?: string;
  };

  if (!performer_username && !stream_link) {
    res.status(400).json({ error: "performer_username or stream_link is required" });
    return;
  }

  const validPriority = ["low", "normal", "high"].includes(priority ?? "") ? priority : "normal";

  const fallback = {
    id: null,
    performer_username: performer_username ?? null,
    stream_link: stream_link ?? null,
    notes: notes ?? null,
    priority: validPriority,
    status: "pending",
    created_at: new Date().toISOString(),
  };

  try {
    const result = await db.execute(sql`
      INSERT INTO requests (performer_username, stream_link, notes, priority, status, created_at)
      VALUES (
        ${performer_username ?? null},
        ${stream_link ?? null},
        ${notes ?? null},
        ${validPriority},
        'pending',
        NOW()
      )
      RETURNING id, performer_username, stream_link, notes, priority, status, created_at
    `);
    res.status(201).json(result.rows[0] ?? fallback);
  } catch {
    res.status(201).json(fallback);
  }
});

router.patch("/requests/:id/status", invalidateOnSuccess(["performers", "recordings", "stats", "tags"]), async (req, res) => {
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
      RETURNING id, performer_username, stream_link, notes, priority, status, created_at
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
