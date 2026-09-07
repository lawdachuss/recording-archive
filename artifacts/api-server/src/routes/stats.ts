import { Router } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";

const router = Router();

router.get("/stats", cache({ ttlSeconds: 120, staleSeconds: 300, tags: ["stats", "recordings"] }), async (req, res) => {
  try {
    // PostgREST can't run SQL aggregates, so stream the needed columns of the
    // recordings_with_links view (rows that actually have a link) and compute
    // all stats in JS. The result is cached for 2 minutes.
    const { data, error } = await fetchAll((start, end) =>
      supabase
        .from("recordings_with_links")
        .select("username,timestamp,filesize,tags")
        .not("links", "is", "null")
        .range(start, end),
    );

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching stats rows");
      res.status(500).json({ error: "Failed to fetch stats" });
      return;
    }

    const rows = data ?? [];
    const performers = new Set<string>();
    const tags = new Set<string>();
    let totalSizeBytes = 0;
    let newestRecording: string | null = null;

    for (const r of rows) {
      if (r.username) performers.add(r.username);
      if (typeof r.filesize === "number") totalSizeBytes += r.filesize;
      if (r.timestamp && (!newestRecording || r.timestamp > newestRecording)) {
        newestRecording = r.timestamp;
      }
      for (const tag of r.tags ?? []) {
        if (tag && tag !== "") tags.add(tag);
      }
    }

    res.json({
      total_recordings: rows.length,
      total_performers: performers.size,
      total_tags: tags.size,
      total_size_bytes: totalSizeBytes,
      newest_recording: newestRecording,
    });
  } catch (err) {
    req.log.error({ err }, "GET /stats unexpected error");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
