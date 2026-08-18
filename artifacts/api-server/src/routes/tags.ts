import { Router } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";

const router = Router();

router.get("/tags", cache({ ttlSeconds: 900, staleSeconds: 1800, tags: ["tags", "recordings", "search"] }), async (req, res) => {
  // Fetch all rows in pages — PostgREST caps a single request at 1,000 rows.
  const { data, error } = await fetchAll((start, end) =>
    supabase
      .from("recordings_with_links")
      .select("tags, links")
      .not("links", "is", "null")
      .range(start, end),
  );

  if (error) {
    req.log.error({ err: error }, "Supabase error listing tags");
    res.status(500).json({ error: "Failed to fetch tags" });
    return;
  }

  // The optimized view returns NULL (not '{}') for recordings without links,
  // so the SQL `.not("links", "is", "null")` filter already excludes them.
  const validRows = data ?? [];

  const tagCounts = new Map<string, number>();

  for (const row of validRows) {
    for (const tag of row.tags ?? []) {
      if (tag && tag.trim()) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  const result = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  res.json(result);
});

export default router;
