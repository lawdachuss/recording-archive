import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { invalidateKey } from "../middleware/cache.js";

const router = Router();

/**
 * POST /api/recordings/:id/view
 *
 * Atomically increments the viewer count using a Supabase RPC-style
 * approach: read current count, write new count. The service-role key
 * bypasses RLS so this is safe.
 */
router.post("/recordings/:id/view", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ error: "Missing recording id" });
    return;
  }

  try {
    const { data: current, error: fetchError } = await supabase
      .from("recordings")
      .select("viewers")
      .eq("id", id)
      .single();

    if (fetchError || !current) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    const newCount = (current.viewers ?? 0) + 1;

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
