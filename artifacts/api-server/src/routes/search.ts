import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { cache } from "../middleware/cache.js";
import { getSuggestionSnapshot, matchSuggestions, maybeBuildSuggestionSnapshot } from "../lib/suggestions.js";

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

/** Escape % and _ in PostgREST ilike patterns to avoid wildcard injection. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}


router.get("/search", cache({ ttlSeconds: 45, staleSeconds: 120, tags: ["search", "recordings", "performers", "tags"] }), async (req, res) => {
  const q = String(req.query.q ?? "").trim();

  if (!q || q.length < 2) {
    res.json({ suggestions: [], query: q ?? "" });
    return;
  }

  // ── Fast path: precomputed suggestion index in Redis ──────────────────
  // A typed (unique) prefix never hits the DB when the snapshot exists; we
  // only filter in-memory arrays built from the last snapshot sync.
  const snapshot = await getSuggestionSnapshot().catch((err) => {
    logger.warn({ err, query: q }, "Suggestion snapshot read failed");
    return null;
  });
  if (snapshot) {
    res.json({ suggestions: matchSuggestions(q, snapshot), query: q, source: "index" });
    return;
  }

  // Snapshot missing (fresh Redis / not yet synced): do not start a full-table
  // snapshot rebuild from a user-facing Vercel request. The daily cache-warm
  // cron owns that expensive maintenance job. On long-lived non-Vercel servers,
  // a single background rebuild is still useful.
  if (!process.env.VERCEL && !process.env.VERCEL_ENV && !process.env.VERCEL_URL) {
    maybeBuildSuggestionSnapshot().catch((err) =>
      logger.error({ err, query: q }, "Background suggestion build kicked off with error"),
    );
  }

  const safeQ = escapeLike(q);
  const suggestions: SearchSuggestion[] = [];

  try {
    // Keep the fallback bounded and concurrent. The previous path executed
    // these searches serially and then paged through up to 20,000 recording
    // rows to find substring matches in tag arrays on every unique prefix.
    // That scan was unindexed, request-driven, and could exhaust the function
    // timeout. Tag suggestions are supplied client-side from the cached /tags
    // list when the Redis snapshot is temporarily unavailable.
    const [performerResult, recordingResult] = await Promise.all([
      supabase
        .from("linked_recordings")
        .select("username, thumbnail_url, sprite_url, preview_url, links")
        
        .ilike("username", `%${safeQ}%`)
        .order("timestamp", { ascending: false }).order("id", { ascending: false })
        .limit(16),
      supabase
        .from("linked_recordings")
        .select("id, username, room_title, filename, thumbnail_url, links")
        
        .or(
          `username.ilike.%${safeQ}%,room_title.ilike.%${safeQ}%,filename.ilike.%${safeQ}%`,
        )
        .order("timestamp", { ascending: false }).order("id", { ascending: false })
        .limit(4),
    ]);

    if (performerResult.error) {
      logger.warn({ err: performerResult.error, query: q }, "Fallback performer suggestions failed");
    } else {
      const seen = new Set<string>();
      for (const p of performerResult.data ?? []) {
        if (!p.username || seen.has(p.username)) continue;
        seen.add(p.username);
        const image = p.thumbnail_url || p.sprite_url || p.preview_url;
        suggestions.push({
          type: "performer",
          label: p.username,
          subtitle: "Performer",
          image_url: image,
          href: `/performers/${encodeURIComponent(p.username)}`,
        });
        if (seen.size >= 4) break;
      }
    }

    if (recordingResult.error) {
      logger.warn({ err: recordingResult.error, query: q }, "Fallback recording suggestions failed");
    } else {
      for (const r of recordingResult.data ?? []) {
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
  } catch (err) {
    logger.error({ err, query: q }, "Search fallback error");
  }


  res.json({ suggestions, query: q });
});

export default router;
