import { Router } from "express";
import { db, sql } from "@workspace/db";
import { cache } from "../middleware/cache.js";

const router = Router();

router.get("/tags", cache({ ttlSeconds: 900, staleSeconds: 1800, tags: ["tags", "recordings", "search"] }), async (req, res) => {
  try {
    // Use SQL aggregation instead of loading all rows into memory.
    // Tags may be stored as jsonb or text[] — use jsonb_array_elements_text
    // which works for both jsonb arrays and text arrays cast to jsonb.
    const result = await db.execute(sql`
      SELECT tag, COUNT(*)::int AS count
      FROM (
        SELECT unnest(tags) AS tag
        FROM recordings_with_links
        WHERE links IS NOT NULL AND tags IS NOT NULL
      ) sub
      WHERE tag IS NOT NULL AND tag != ''
      GROUP BY tag
      ORDER BY count DESC
    `);

    const tags = result.rows.map((r: any) => ({ tag: r.tag as string, count: r.count as number }));
    res.json(tags);
  } catch (err) {
    req.log.error({ err }, "GET /tags unexpected error");
    res.status(500).json({ error: "Failed to fetch tags" });
  }
});

export default router;
