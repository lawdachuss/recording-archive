import { Router } from "express";
import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";

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

import { cache } from "../middleware/cache";

router.get("/search", cache({ ttlSeconds: 30, tags: ["search"] }), async (req, res) => {
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
      const validPerformers = performers.filter(
        (p) => p.links && typeof p.links === "object" && Object.keys(p.links).length > 0,
      );
      const seen = new Set<string>();
      for (const p of validPerformers) {
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
      const validRecordings = recordings.filter(
        (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
      );
      for (const r of validRecordings) {
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
    // We query recordings for distinct tags matching the query
    const { data: tags, error: tagErr } = await supabase
      .from("recordings_with_links")
      .select("tags, links")
      .not("links", "is", "null");

    if (!tagErr && tags) {
      const validTags = tags.filter(
        (t) => t.links && typeof t.links === "object" && Object.keys(t.links).length > 0,
      );
      const matchedTags = new Set<string>();
      const lowerQ = q.toLowerCase();

      for (const row of tags) {
        if (matchedTags.size >= 4) break;
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
      }
    }
  } catch (err) {
    logger.error({ err, query: q }, "Search error");
  }

  res.json({ suggestions, query: q });
});

export default router;
