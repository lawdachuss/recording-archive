import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { db, sql } from "@workspace/db";
import { invalidateKey } from "../middleware/cache.js";

const router = Router();

/**
 * POST /api/recordings/:id/view
 *
 * Atomically increments the viewer count using a raw SQL UPDATE + RETURNING
 * to avoid the read-then-write race that could lose concurrent view counts.
 */
router.post("/recordings/:id/view", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ error: "Missing recording id" });
    return;
  }

  try {
    // Use SQL atomic UPDATE ... SET viewers = viewers + 1 RETURNING viewers
    // to avoid the race condition of reading then writing the count.
    const result = await db.execute(sql`
      UPDATE recordings SET viewers = COALESCE(viewers, 0) + 1
      WHERE id = ${id}
      RETURNING viewers
    `);

    if (!result.rows.length) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    const newCount = Number(result.rows[0].viewers);

    invalidateKey(`/api/recordings/${id}`).catch((err) =>
      req.log.error({ err, id }, "Failed to invalidate recording cache after view"),
    );

    res.json({ viewers: newCount });
  } catch (err) {
    req.log.error({ err, id }, "Unexpected error recording view");
    res.status(500).json({ error: "Failed to record view" });
  }
});

export default router;
