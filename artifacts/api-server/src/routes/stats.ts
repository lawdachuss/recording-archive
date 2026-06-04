import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/stats", async (req, res) => {
  const { data, error } = await supabase
    .from("recordings")
    .select("username, tags, filesize, timestamp");

  if (error) {
    req.log.error({ err: error }, "Supabase error fetching stats");
    res.status(500).json({ error: "Failed to fetch stats" });
    return;
  }

  const rows = data ?? [];

  const uniquePerformers = new Set(rows.map((r) => r.username)).size;
  const uniqueTags = new Set(rows.flatMap((r) => r.tags ?? [])).size;
  const totalSize = rows.reduce((sum, r) => sum + (r.filesize ?? 0), 0);

  const newest = rows
    .map((r) => r.timestamp)
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  res.json({
    total_recordings: rows.length,
    total_performers: uniquePerformers,
    total_tags: uniqueTags,
    total_size_bytes: totalSize,
    newest_recording: newest,
  });
});

export default router;
