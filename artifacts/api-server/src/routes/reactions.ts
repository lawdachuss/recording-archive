import { Router } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache, invalidateOnSuccess } from "../middleware/cache.js";

async function getReactionCounts(recordingId: string) {
  const { data, error } = await fetchAll((start, end) =>
    supabase
      .from("reactions")
      .select("type")
      .eq("recording_id", recordingId)
      .range(start, end),
  );
  if (error) throw error;

  let likes = 0;
  let dislikes = 0;
  for (const r of data ?? []) {
    if (r.type === "like") likes++;
    else if (r.type === "dislike") dislikes++;
  }
  return { likes, dislikes };
}

async function getUserReaction(recordingId: string, sessionId: string): Promise<string | null> {
  const { data } = await supabase
    .from("reactions")
    .select("type")
    .eq("recording_id", recordingId)
    .eq("session_id", sessionId)
    .maybeSingle();
  return (data?.type as string | null) ?? null;
}

/**
 * Like/dislike toggle. The unique constraint (recording_id, session_id) is the
 * source of truth for conflicts, mirroring the old transaction-based toggle.
 */
async function toggleReaction(recordingId: string, type: string, sessionId: string) {
  const { data: existing } = await supabase
    .from("reactions")
    .select("id, type")
    .eq("recording_id", recordingId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existing) {
    if (existing.type === type) {
      const { error } = await supabase
        .from("reactions")
        .delete()
        .eq("recording_id", recordingId)
        .eq("session_id", sessionId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("reactions")
        .update({ type })
        .eq("recording_id", recordingId)
        .eq("session_id", sessionId);
      if (error) throw error;
    }
  } else {
    const { error } = await supabase
      .from("reactions")
      .insert({ recording_id: recordingId, session_id: sessionId, type });
    if (error) throw error;
  }
}

const router = Router();

router.get("/reactions", cache({ ttlSeconds: 15, staleSeconds: 60, tags: ["reactions"] }), async (req, res) => {
  try {
    const { recording_id, session_id } = req.query as Record<string, string>;
    if (!recording_id) {
      res.status(400).json({ error: "recording_id is required" });
      return;
    }

    const counts = await getReactionCounts(recording_id);
    const user_reaction = session_id ? await getUserReaction(recording_id, session_id) : null;

    res.json({ ...counts, user_reaction });
  } catch (err) {
    req.log?.error?.({ err, recording_id: req.query.recording_id }, "GET /reactions error");
    res.status(500).json({ error: "Failed to fetch reactions" });
  }
});

router.post("/reactions", invalidateOnSuccess(["reactions", "stats"]), async (req, res) => {
  try {
    const { recording_id, type, session_id } = req.body as {
      recording_id: string;
      type: string;
      session_id: string;
    };

    if (!recording_id || !type || !session_id) {
      res.status(400).json({ error: "recording_id, type, and session_id are required" });
      return;
    }
    if (type !== "like" && type !== "dislike") {
      res.status(400).json({ error: "type must be 'like' or 'dislike'" });
      return;
    }

    await toggleReaction(recording_id, type, session_id);

    const counts = await getReactionCounts(recording_id);
    const user_reaction = await getUserReaction(recording_id, session_id);

    res.json({ ...counts, user_reaction });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error?.({ err, body: req.body, recording_id: req.body?.recording_id }, "POST /reactions error");
    if (/connection|timeout|terminated|serializ|deadlock|lock/i.test(msg)) {
      res.status(503).json({ error: "Temporary service issue, please try again" });
      return;
    }
    res.status(500).json({ error: "Failed to process reaction" });
  }
});

// Nested routes matching /api/recordings/:recording_id/reactions (called by frontend)
router.get("/recordings/:recording_id/reactions", cache({ ttlSeconds: 15, staleSeconds: 60, tags: ["reactions"] }), async (req, res) => {
  try {
    const recording_id = String(req.params.recording_id);
    const { session_id } = req.query as Record<string, string>;

    const counts = await getReactionCounts(recording_id);
    const user_reaction = session_id ? await getUserReaction(recording_id, session_id) : null;

    res.json({ ...counts, user_reaction });
  } catch (err) {
    req.log?.error?.({ err, recording_id: req.params.recording_id }, "GET /recordings/:id/reactions error");
    res.status(500).json({ error: "Failed to fetch reactions" });
  }
});

router.post("/recordings/:recording_id/reactions", invalidateOnSuccess(["reactions", "stats"]), async (req, res) => {
  try {
    const recording_id = String(req.params.recording_id);
    const { type, session_id } = req.body as { type: string; session_id: string };

    if (!type || !session_id) {
      res.status(400).json({ error: "type and session_id are required" });
      return;
    }
    if (type !== "like" && type !== "dislike") {
      res.status(400).json({ error: "type must be 'like' or 'dislike'" });
      return;
    }

    await toggleReaction(recording_id, type, session_id);

    const counts = await getReactionCounts(recording_id);
    const user_reaction = await getUserReaction(recording_id, session_id);

    res.json({ ...counts, user_reaction });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error?.({ err, recording_id: req.params.recording_id }, "POST /recordings/:id/reactions error");
    if (/connection|timeout|terminated|serializ|deadlock|lock/i.test(msg)) {
      res.status(503).json({ error: "Temporary service issue, please try again" });
      return;
    }
    res.status(500).json({ error: "Failed to process reaction" });
  }
});

export default router;
