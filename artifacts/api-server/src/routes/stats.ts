import { Router } from "express";
import { db, sql } from "@workspace/db";
import { cache } from "../middleware/cache.js";

const router = Router();

router.get("/stats", cache({ ttlSeconds: 120, staleSeconds: 300, tags: ["stats", "recordings"] }), async (req, res) => {
  try {
    // Use SQL aggregation instead of loading all rows into memory.
    // With 8,000+ recordings, fetching every row just to count is extremely slow.
    const [countResult, sizeResult, newestResult, performersResult, tagsResult] = await Promise.all([
      // Total recordings with links
      db.execute(sql`
        SELECT COUNT(*)::int AS count FROM recordings_with_links WHERE links IS NOT NULL
      `),
      // Total storage
      db.execute(sql`
        SELECT COALESCE(SUM(filesize), 0)::bigint AS total FROM recordings_with_links WHERE links IS NOT NULL
      `),
      // Newest recording timestamp
      db.execute(sql`
        SELECT MAX(timestamp) AS newest FROM recordings_with_links WHERE links IS NOT NULL
      `),
      // Unique performers count
      db.execute(sql`
        SELECT COUNT(DISTINCT username)::int AS count FROM recordings_with_links WHERE links IS NOT NULL
      `),
      // Unique tags count — unnest the tags array and count distinct values
      db.execute(sql`
        SELECT COUNT(DISTINCT tag)::int AS count FROM (
          SELECT unnest(tags) AS tag FROM recordings_with_links WHERE links IS NOT NULL AND tags IS NOT NULL
        ) sub
      `),
    ]);

    const countRow = countResult.rows[0] as { count: number } | undefined;
    const sizeRow = sizeResult.rows[0] as { total: number } | undefined;
    const newestRow = newestResult.rows[0] as { newest: string | null } | undefined;
    const performersRow = performersResult.rows[0] as { count: number } | undefined;
    const tagsRow = tagsResult.rows[0] as { count: number } | undefined;

    res.json({
      total_recordings: countRow?.count ?? 0,
      total_performers: performersRow?.count ?? 0,
      total_tags: tagsRow?.count ?? 0,
      total_size_bytes: Number(sizeRow?.total ?? 0),
      newest_recording: newestRow?.newest ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "GET /stats unexpected error");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
