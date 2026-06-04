import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/tags", async (req, res) => {
  const { data, error } = await supabase
    .from("recordings")
    .select("tags");

  if (error) {
    req.log.error({ err: error }, "Supabase error listing tags");
    res.status(500).json({ error: "Failed to fetch tags" });
    return;
  }

  const tagCounts = new Map<string, number>();

  for (const row of data ?? []) {
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
