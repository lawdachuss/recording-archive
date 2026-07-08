import { Router } from "express";
import { supabase } from "../lib/supabase";
import { invalidateKey } from "../middleware/cache";

const router = Router();

/**
 * POST /api/recordings/:id/view
 *
 * Increments the viewer count for a recording.
 * Deduplication is handled client-side via sessionStorage — the frontend
 * only sends this request once per video per browser session.
 *
 * Returns the updated viewer count.
 *
 * Note: Uses read-then-write which has a tiny race window, but for view
 * counters this is acceptable (off-by-1-2 under concurrent requests).
 */
router.post("/recordings/:id/view", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ error: "Missing recording id" });
    return;
  }

  try {
    // Read current count
    const { data: current, error: fetchError } = await supabase
      .from("recordings")
      .select("viewers")
      .eq("id", id)
      .single();

    if (fetchError || !current) {
      req.log.error({ err: fetchError, id }, "Failed to fetch recording for view increment");
      res.status(500).json({ error: "Failed to record view" });
      return;
    }

    const newCount = (current.viewers ?? 0) + 1;

    // Update with incremented count
    const { error: updateError } = await supabase
      .from("recordings")
      .update({ viewers: newCount })
      .eq("id", id);

    if (updateError) {
      req.log.error({ err: updateError, id }, "Failed to update view count");
      res.status(500).json({ error: "Failed to record view" });
      return;
    }

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
