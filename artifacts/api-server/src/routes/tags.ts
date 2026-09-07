import { Router } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";

const router = Router();

/**
 * Tag counts via the get_tag_counts() Postgres RPC (see
 * supabase/migrations/001_aggregate_rpcs.sql) — aggregation happens in the
 * database and the payload is tiny, instead of streaming every row of
 * recordings_with_links through PostgREST and counting in JS.
 *
 * If the RPC isn't applied yet (404 from PostgREST), falls back to the
 * legacy fetchAll path so a deploy is never blocked on the migration.
 */

interface TagCount {
  tag: string;
  count: number;
}

async function fetchTagCountsViaRpc(): Promise<TagCount[] | null> {
  // PostgREST RPC: POST /rest/v1/rpc/get_tag_counts
  const { data, error } = await supabase.rpc("get_tag_counts");
  if (error) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? "";
    // PGRST202 = "function not found in schema" — migration not applied yet.
    if (code === "PGRST202" || /function.*not.*found|Could not find the function/i.test(message)) {
      return null; // signal fallback
    }
    throw error;
  }
  return (data ?? []) as TagCount[];
}

async function fetchTagCountsLegacy(): Promise<TagCount[]> {
  // PostgREST can't unnest arrays, so stream just the tags column of rows
  // that have a link and count occurrences in JS.
  const { data, error } = await fetchAll((start, end) =>
    supabase
      .from("recordings_with_links")
      .select("tags")
      .not("links", "is", "null")
      .not("tags", "is", "null")
      .range(start, end),
  );

  if (error) {
    throw error;
  }

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    for (const tag of r.tags ?? []) {
      if (tag && tag !== "") counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

router.get("/tags", cache({ ttlSeconds: 900, staleSeconds: 1800, tags: ["tags", "recordings", "search"] }), async (req, res) => {
  try {
    let tags: TagCount[];
    try {
      const viaRpc = await fetchTagCountsViaRpc();
      if (viaRpc) {
        tags = viaRpc;
      } else {
        req.log.warn("get_tag_counts RPC not available — falling back to legacy aggregation");
        tags = await fetchTagCountsLegacy();
      }
    } catch (err) {
      req.log.error({ err }, "Tag aggregation error");
      res.status(500).json({ error: "Failed to fetch tags" });
      return;
    }

    res.json(tags);
  } catch (err) {
    req.log.error({ err }, "GET /tags unexpected error");
    res.status(500).json({ error: "Failed to fetch tags" });
  }
});

export default router;
