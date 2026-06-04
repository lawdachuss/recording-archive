import { Router } from "express";
import { GetPerformerParams } from "@workspace/api-zod";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/performers", async (req, res) => {
  const { data, error } = await supabase
    .from("recordings")
    .select("username, gender, thumbnail_url, timestamp")
    .order("timestamp", { ascending: false });

  if (error) {
    req.log.error({ err: error }, "Supabase error listing performers");
    res.status(500).json({ error: "Failed to fetch performers" });
    return;
  }

  const performerMap = new Map<
    string,
    {
      username: string;
      recording_count: number;
      latest_thumbnail: string | null;
      gender: string | null;
      latest_timestamp: string | null;
    }
  >();

  for (const row of data ?? []) {
    if (!performerMap.has(row.username)) {
      performerMap.set(row.username, {
        username: row.username,
        recording_count: 1,
        latest_thumbnail: row.thumbnail_url,
        gender: row.gender,
        latest_timestamp: row.timestamp,
      });
    } else {
      const existing = performerMap.get(row.username)!;
      existing.recording_count += 1;
    }
  }

  const performers = Array.from(performerMap.values()).sort(
    (a, b) => b.recording_count - a.recording_count,
  );

  res.json(performers);
});

router.get("/performers/:username", async (req, res) => {
  const parsed = GetPerformerParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const { username } = parsed.data;

  const { data, error } = await supabase
    .from("recordings")
    .select("*")
    .eq("username", username)
    .order("timestamp", { ascending: false });

  if (error || !data || data.length === 0) {
    res.status(404).json({ error: "Performer not found" });
    return;
  }

  res.json({
    username,
    recording_count: data.length,
    gender: data[0].gender ?? null,
    recordings: data,
  });
});

export default router;
