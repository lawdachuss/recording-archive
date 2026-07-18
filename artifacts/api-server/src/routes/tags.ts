import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";

const router = Router();

router.get("/tags", cache({ ttlSeconds: 900, staleSeconds: 1800, tags: ["tags", "recordings", "search"] }), async (req, res) => {
  const { data, error } = await supabase
    .from("recordings_with_links")
    .select("tags, links")
    .not("links", "is", "null");

  if (error) {
    req.log.error({ err: error }, "Supabase error listing tags");
    res.status(500).json({ error: "Failed to fetch tags" });
    return;
  }

  const validRows = (data ?? []).filter(
    (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
  );

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
