import { Router } from "express";
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

  const query = `%${q}%`;
  const suggestions: SearchSuggestion[] = [];

  try {
    // 1. Performer suggestions (username matches, up to 4)
    const { data: performers, error: perfErr } = await supabase
      .from("recordings_with_links")
      .select("username, thumbnail_url, sprite_url, preview_url, links")
      .not("links", "is", "null")
      .ilike("username", query)
      .order("timestamp", { ascending: false })
      .limit(4);

    if (!perfErr && performers) {
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
    const { data: recordings, error: recErr } = await supabase
      .from("recordings_with_links")
      .select("id, username, room_title, filename, thumbnail_url, links")
      .not("links", "is", "null")
      .or(
        `username.ilike.${query},room_title.ilike.${query},filename.ilike.${query}`,
      )
      .order("timestamp", { ascending: false })
      .limit(4);

    if (!recErr && recordings) {
      for (const r of recordings) {
        const title = r.room_title || r.filename;
        suggestions.push({
          type: "recording",
          label: title?.length > 60 ? title.slice(0, 57) + "…" : title ?? "Untitled",
          subtitle: r.username,
          image_url: r.thumbnail_url,
          href: `/video/${r.id}`,
        });
      }
    }

    // 3. Tag suggestions (tag name matches, up to 4)
    // Tags are stored as a PostgreSQL array on each recording row, so we
    // paginate through recordings until we collect 4 matching distinct tags.
    // This avoids fetching the entire table — we stop as soon as we have enough.
    {
      const matchedTags = new Set<string>();
      const lowerQ = q.toLowerCase();
      const TAG_PAGE = 1000;
      let offset = 0;

      while (matchedTags.size < 4) {
        const { data: tagPage, error: tagErr } = await supabase
          .from("recordings_with_links")
          .select("tags")
          .not("links", "is", "null")
          .range(offset, offset + TAG_PAGE - 1);

        if (tagErr || !tagPage || tagPage.length === 0) break;

        for (const row of tagPage) {
          if (!row.tags) continue;
          for (const tag of row.tags) {
            if (matchedTags.size >= 4) break;
            if (tag?.toLowerCase().includes(lowerQ) && !matchedTags.has(tag)) {
              matchedTags.add(tag);
              suggestions.push({
                type: "tag",
                label: tag,
                subtitle: "Tag",
                href: `/browse?tags=${encodeURIComponent(tag)}`,
              });
            }
          }
          if (matchedTags.size >= 4) break;
        }

        // If we got fewer rows than the page size, we've exhausted the table
        if (tagPage.length < TAG_PAGE) break;
        offset += TAG_PAGE;
      }
    }
  } catch (err) {
    logger.error({ err, query: q }, "Search error");
  }

  res.json({ suggestions, query: q });
});

export default router;
