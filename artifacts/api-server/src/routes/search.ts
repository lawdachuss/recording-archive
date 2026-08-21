import { Router } from "express";
import { db, sql, pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();

interface SearchSuggestion {
  type: "performer" | "recording" | "tag";
  label: string;
  subtitle?: string;
  image_url?: string | null;
  href: string;
}

/**
 * GET /api/search?q=...
 *
 * Returns up to 10 search suggestions grouped by category:
 * - performers (matches by username, limited to 4)
 * - recordings (matches by username/title/filename, limited to 4)
 * - tags (matches by tag name, limited to 4)
 *
 * Results are cached by the downstream cache middleware for 30s.
 */

import { cache } from "../middleware/cache.js";

router.get("/search", cache({ ttlSeconds: 45, staleSeconds: 120, tags: ["search", "recordings", "performers", "tags"] }), async (req, res) => {
  const q = String(req.query.q ?? "").trim();

  if (!q || q.length < 2) {
    res.json({ suggestions: [], query: q ?? "" });
    return;
  }

  const query = `%${q.toLowerCase()}%`;
  const suggestions: SearchSuggestion[] = [];

  try {
    // 1. Performer suggestions (username matches, up to 4)
    // Use pool.query() because PostgREST can't properly query recordings_with_links
    const perfResult = await pool.query(
      `SELECT DISTINCT ON (username) username, thumbnail_url, sprite_url, preview_url
       FROM recordings_with_links
       WHERE links IS NOT NULL AND LOWER(username) LIKE $1
       ORDER BY username, "timestamp" DESC
       LIMIT 4`,
      [query],
    );

    const seenPerf = new Set<string>();
    for (const p of perfResult.rows) {
      if (seenPerf.has(p.username)) continue;
      seenPerf.add(p.username);
      const image = p.thumbnail_url || p.sprite_url || p.preview_url;
      suggestions.push({
        type: "performer",
        label: p.username,
        subtitle: "Performer",
        image_url: image,
        href: `/performers/${encodeURIComponent(p.username)}`,
      });
    }

    // 2. Recording suggestions (username, title, or filename matches, up to 4)
    const recResult = await pool.query(
      `SELECT id, username, room_title, filename, thumbnail_url
       FROM recordings_with_links
       WHERE links IS NOT NULL
         AND (LOWER(username) LIKE $1 OR LOWER(room_title) LIKE $1 OR LOWER(filename) LIKE $1)
       ORDER BY "timestamp" DESC
       LIMIT 4`,
      [query],
    );

    for (const r of recResult.rows) {
      const title = r.room_title || r.filename;
      suggestions.push({
        type: "recording",
        label: title?.length > 60 ? title.slice(0, 57) + "\u2026" : title ?? "Untitled",
        subtitle: r.username,
        image_url: r.thumbnail_url,
        href: `/video/${r.id}`,
      });
    }

    // 3. Tag suggestions (tag name matches, up to 4)
    // Use SQL unnest() to expand PostgreSQL text[] tags into individual rows,
    // then GROUP BY and match — runs entirely in the database instead of
    // paginating through thousands of rows client-side.
    {
      try {
        const lowerQ = q.toLowerCase();
        const tagResult = await db.execute(sql`
          SELECT DISTINCT tag
          FROM (
            SELECT unnest(tags) AS tag
            FROM recordings_with_links
            WHERE links IS NOT NULL
          ) sub
          WHERE LOWER(tag) LIKE ${`%${lowerQ}%`}
          LIMIT 4
        `);
        for (const row of tagResult.rows) {
          const tag = row.tag as string;
          suggestions.push({
            type: "tag",
            label: tag,
            subtitle: "Tag",
            href: `/browse?tags=${encodeURIComponent(tag)}`,
          });
        }
      } catch {
        // Non-critical — tag suggestions are a nice-to-have
      }
    }
  } catch (err) {
    logger.error({ err, query: q }, "Search error");
  }

  res.json({ suggestions, query: q });
});

export default router;
