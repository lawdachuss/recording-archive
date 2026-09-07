import { Router } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";

const router = Router();

router.get("/tags", cache({ ttlSeconds: 900, staleSeconds: 1800, tags: ["tags", "recordings", "search"] }), async (req, res) => {
  try {
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
      req.log.error({ err: error }, "Supabase error fetching tags");
      res.status(500).json({ error: "Failed to fetch tags" });
      return;
    }

    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      for (const tag of r.tags ?? []) {
        if (tag && tag !== "") counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    res.json(tags);
  } catch (err) {
    req.log.error({ err }, "GET /tags unexpected error");
    res.status(500).json({ error: "Failed to fetch tags" });
  }
});

export default router;
