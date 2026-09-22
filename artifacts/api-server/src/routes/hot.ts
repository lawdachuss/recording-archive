import { Router } from "express";
import { cache } from "../middleware/cache.js";
import { getHotRecordings, getHotPerformers, type HotRecording, type HotPerformer } from "../lib/hot-cache.js";
import { getSuggestionSnapshot } from "../lib/suggestions.js";
import { supabase } from "../lib/supabase.js";

const router = Router();

// Hot cache serves the trending leaderboards from Redis ZSETs (bumped by every
// play) in a single ZREVRANGE + HMGET round trip. When the sets are empty
// (fresh Redis, site quiet) it falls back to a bounded DB query so the endpoint
// always answers. Results are additionally cached by cache() middleware.

router.get(
  "/hot/recordings",
  cache({ ttlSeconds: 60, staleSeconds: 300, tags: ["recordings", "search", "stats"] }),
  async (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "24"), 10) || 24));

    try {
      const hot = await getHotRecordings(limit);
      if (hot.length > 0) {
        res.json({ data: hot, source: "redis" });
        return;
      }

      // Cold fallback — top by lifetime viewers is the closest DB-legal proxy
      // for "trending" until real plays accumulate in the ZSETs.
      const { data, error } = await supabase
        .from("recordings_with_links")
        .select("id,username,room_title,thumbnail_url,sprite_url,viewers")
        .not("links", "is", "null")
        .order("viewers", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) {
        res.status(500).json({ error: "Failed to fetch hot recordings" });
        return;
      }
      const rows: HotRecording[] = (data ?? []).map((r: any) => ({
        id: r.id,
        username: r.username,
        title: r.room_title,
        image_url: r.thumbnail_url || r.sprite_url,
        score: Number(r.viewers) || 0,
      }));
      res.json({ data: rows, source: "db" });
    } catch (err) {
      req.log.error({ err }, "GET /hot/recordings unexpected error");
      res.status(500).json({ error: "Failed to fetch hot recordings" });
    }
  },
);

router.get(
  "/hot/performers",
  cache({ ttlSeconds: 60, staleSeconds: 300, tags: ["performers", "recordings"] }),
  async (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

    try {
      const hot = await getHotPerformers(limit);
      if (hot.length > 0) {
        res.json({ data: hot, source: "redis" });
        return;
      }

      // Cold fallback — the suggestion snapshot holds performers ranked by
      // recording count, a stable stand-in for "popular" until heat accrues.
      const snapshot = await getSuggestionSnapshot().catch(() => null);
      if (snapshot && snapshot.performers.length > 0) {
        const rows: HotPerformer[] = snapshot.performers.slice(0, limit).map((p, i) => ({
          username: p.label,
          image_url: p.image_url,
          score: snapshot.performers.length - i,
        }));
        res.json({ data: rows, source: "db" });
        return;
      }
      res.json({ data: [], source: "db" });
    } catch (err) {
      req.log.error({ err }, "GET /hot/performers unexpected error");
      res.status(500).json({ error: "Failed to fetch hot performers" });
    }
  },
);

export default router;