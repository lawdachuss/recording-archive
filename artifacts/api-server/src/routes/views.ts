import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { invalidateKey } from "../middleware/cache.js";
import { recordView } from "../lib/view-buffer.js";

const router = Router();

/**
 * POST /api/recordings/:id/view
 *
 * View counting is write-coalesced in Redis: a play is an INCR + ZADD (no DB),
 * and the buffered increments are flushed to the `recordings.viewers` column
 * in batches (self-hosted cadence, cache-warm cron, admin flush, or a per-
 * recording threshold). The client gets back base + pending — the same number
 * a cache layer would have served.
 *
 * When Redis is unavailable the route degrades to the original direct path:
 * atomically incrementing via increment_viewer_count() SQL (single UPDATE …
 * RETURNING) so concurrent requests cannot lose increments to a read-modify-
 * write race. Falls back to the legacy read-then-write path if the RPC isn't
 * deployed yet.
 */
router.post("/recordings/:id/view", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    res.status(400).json({ error: "Missing recording id" });
    return;
  }

  // Coalesced (fast) path — no Postgres contact for the common case.
  const bufferedViewers = await recordView(id);
  if (bufferedViewers !== null) {
    res.json({ viewers: bufferedViewers, buffered: true });
    return;
  }

  try {
    const { data, error } = await supabase.rpc("increment_viewer_count", {
      p_recording_id: id,
    });

    // The RPC returns a single scalar integer (RETURNS integer), so a
    // successful call already incremented the count — use it directly.
    let newCount: number | null = null;
    if (!error && typeof data === "number") {
      newCount = data;
    } else {
      // PGRST202 / "function not found" → migration not applied yet. Fall
      // back to the legacy read-then-write path ONLY when the RPC failed.
      const code = (error as { code?: string } | null)?.code;
      const message = (error as { message?: string } | null)?.message ?? "";
      if (error && code !== "PGRST202" && !/function.*not.*found|Could not find the function/i.test(message)) {
        res.status(500).json({ error: "Failed to record view" });
        return;
      }

      const { data: current, error: fetchError } = await supabase
        .from("recordings")
        .select("viewers")
        .eq("id", id)
        .single();

      if (fetchError || !current) {
        res.status(404).json({ error: "Recording not found" });
        return;
      }

      newCount = (Number(current.viewers) || 0) + 1;

      const { error: updateError } = await supabase
        .from("recordings")
        .update({ viewers: newCount })
        .eq("id", id);

      if (updateError) {
        req.log.error({ err: updateError, id }, "Failed to update view count");
        res.status(500).json({ error: "Failed to record view" });
        return;
      }
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