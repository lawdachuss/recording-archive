import { Router } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";

const router = Router();

/**
 * Site stats via the get_site_stats() Postgres RPC (see
 * supabase/migrations/001_aggregate_rpcs.sql) — one cheap aggregate query in
 * the database instead of streaming every row of recordings_with_links
 * through PostgREST and aggregating in JS.
 *
 * If the RPC isn't applied yet (404 from PostgREST), falls back to the
 * legacy fetchAll path so a deploy is never blocked on the migration.
 */

interface SiteStats {
  total_recordings: number;
  total_performers: number;
  total_tags: number;
  total_size_bytes: number;
  newest_recording: string | null;
}

async function fetchStatsViaRpc(): Promise<SiteStats | null> {
  const { data, error } = await supabase.rpc("get_site_stats");
  if (error) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? "";
    // PGRST202 = "function not found in schema" — migration not applied yet.
    if (code === "PGRST202" || /function.*not.*found|Could not find the function/i.test(message)) {
      return null; // signal fallback
    }
    throw error;
  }
  const row = (data ?? [])[0] as Partial<SiteStats> | undefined;
  if (!row) return null;
  return {
    total_recordings: Number(row.total_recordings ?? 0),
    total_performers: Number(row.total_performers ?? 0),
    total_tags: Number(row.total_tags ?? 0),
    total_size_bytes: Number(row.total_size_bytes ?? 0),
    newest_recording: row.newest_recording ?? null,
  };
}

async function fetchStatsLegacy(): Promise<SiteStats> {
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
    throw error;
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

  return {
    total_recordings: rows.length,
    total_performers: performers.size,
    total_tags: tags.size,
    total_size_bytes: totalSizeBytes,
    newest_recording: newestRecording,
  };
}

router.get("/stats", cache({ ttlSeconds: 120, staleSeconds: 300, tags: ["stats", "recordings"] }), async (req, res) => {
  try {
    let stats: SiteStats;
    try {
      const viaRpc = await fetchStatsViaRpc();
      if (viaRpc) {
        stats = viaRpc;
      } else {
        req.log.warn("get_site_stats RPC not available — falling back to legacy aggregation");
        stats = await fetchStatsLegacy();
      }
    } catch (err) {
      req.log.error({ err }, "Stats aggregation error");
      res.status(500).json({ error: "Failed to fetch stats" });
      return;
    }

    res.json(stats);
  } catch (err) {
    req.log.error({ err }, "GET /stats unexpected error");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
