import { Router } from "express";
import { db, sql } from "@workspace/db";
import { supabase } from "../lib/supabase.js";
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

  const suggestions: SearchSuggestion[] = [];

  try {
    // 1. Performer suggestions (username matches, up to 4)
    // Use Supabase client — reads from supabase.chuglii.in (current data)
    const { data: performers } = await supabase
      .from("recordings_with_links")
      .select("username, thumbnail_url, sprite_url, preview_url, links")
      .not("links", "is", "null")
      .ilike("username", `%${q}%`)
      .order("timestamp", { ascending: false })
      .limit(4);

    if (performers) {
      const seen = new Set<string>();
      for (const p of performers) {
        if (seen.has(p.username)) continue;
        seen.add(p.username);
        const image = p.thumbnail_url || p.sprite_url || p.preview_url;
        suggestions.push({
          type: "performer",
          label: p.username,
          subtitle: "Performer",
          image_url: image,
          href: `/performers/${encodeURIComponent(p.username)}`,
        });
      }
    }

    // 2. Recording suggestions (username, title, or filename matches, up to 4)
    const { data: recordings } = await supabase
      .from("recordings_with_links")
      .select("id, username, room_title, filename, thumbnail_url, links")
      .not("links", "is", "null")
      .or(
        `username.ilike.%${q}%,room_title.ilike.%${q}%,filename.ilike.%${q}%`,
      )
      .order("timestamp", { ascending: false })
      .limit(4);

    if (recordings) {
      for (const r of recordings) {
        const title = r.room_title || r.filename;
        suggestions.push({
          type: "recording",
          label: title?.length > 60 ? title.slice(0, 57) + "\u2026" : title ?? "Untitled",
          subtitle: r.username,
          image_url: r.thumbnail_url,
          href: `/video/${r.id}`,
        });
      }
    }

    // 3. Tag suggestions — use db.execute (cloud pooler has tags populated)
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
