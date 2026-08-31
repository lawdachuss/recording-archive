import { Router } from "express";
import { db, sql } from "@workspace/db";
import { cache } from "../middleware/cache.js";

const router = Router();

router.get("/stats", cache({ ttlSeconds: 120, staleSeconds: 300, tags: ["stats", "recordings"] }), async (req, res) => {
  try {
    // Single query for all stats — the recordings_with_links view is expensive
    // (JOIN + GROUP BY), so running 5 parallel queries exhausts the connection
    // pool and times out. One query with conditional aggregation is faster and
    // more reliable.
    const result = await db.execute(sql`
      WITH base AS (
        SELECT username, timestamp, filesize, tags
        FROM recordings_with_links
        WHERE links IS NOT NULL
      ),
      tag_stats AS (
        SELECT COUNT(DISTINCT tag)::int AS total_tags
        FROM base, unnest(tags) AS tag
        WHERE tag IS NOT NULL AND tag != ''
      )
      SELECT
        (SELECT COUNT(*)::int FROM base) AS total_recordings,
        (SELECT COUNT(DISTINCT username)::int FROM base) AS total_performers,
        (SELECT COALESCE(SUM(filesize), 0)::bigint FROM base) AS total_size_bytes,
        (SELECT MAX(timestamp) FROM base) AS newest_recording,
        (SELECT total_tags FROM tag_stats) AS total_tags
    `);

    const row = result.rows[0] as {
      total_recordings: number;
      total_performers: number;
      total_size_bytes: number | string;
      newest_recording: string | null;
      total_tags: number;
    } | undefined;

    res.json({
      total_recordings: row?.total_recordings ?? 0,
      total_performers: row?.total_performers ?? 0,
      total_tags: row?.total_tags ?? 0,
      total_size_bytes: Number(row?.total_size_bytes ?? 0),
      newest_recording: row?.newest_recording ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "GET /stats unexpected error");
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
