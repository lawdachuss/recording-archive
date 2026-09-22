import { Router, type IRouter, type Request, type Response } from "express";
import { getRedis, isRedisConnected, getRedisStatus } from "../lib/redis.js";
import { getCacheStats, getCacheMetrics, resetCacheMetrics, invalidateTags, invalidatePattern, purgeAllCache } from "../middleware/cache.js";
import { requireRole } from "../middleware/requireRole.js";
import { logger } from "../lib/logger.js";
import { getMediaRedisStats, clearMediaRedisCache } from "../lib/media-cache.js";
import { getHotStats, clearHotCache } from "../lib/hot-cache.js";
import { getViewBufferStats, flushPendingViews, clearViewBuffer } from "../lib/view-buffer.js";
import { buildSuggestionSnapshot, getSuggestionStats, maybeBuildSuggestionSnapshot } from "../lib/suggestions.js";

const router: IRouter = Router();

const admin = requireRole("admin");

// GET /api/cache/status — Check cache status
router.get("/cache/status", ...admin, async (_req: Request, res: Response) => {
  const redis = getRedis();
  const status = getRedisStatus();
  const connected = isRedisConnected();

  const [media, hot, views, suggestions] = await Promise.all([
    getMediaRedisStats(),
    getHotStats(),
    getViewBufferStats(),
    getSuggestionStats(),
  ]);

  let info: Record<string, unknown> = {
    connected,
    status,
    memory: getCacheStats(),
    metrics: getCacheMetrics(),
    redisSystems: {
      media,
      hot,
      views,
      suggestions,
    },
  };

  if (redis && connected) {
    try {
      const dbsize = await redis.dbsize();
      info = { ...info, keys: dbsize };
    } catch {
      info = { ...info, keys: "error" };
    }
  }

  res.json(info);
});

// POST /api/cache/invalidate — Invalidate by tags or pattern
router.post("/cache/invalidate", ...admin, async (req: Request, res: Response) => {
  const { tags, pattern } = req.body as {
    tags?: string[];
    pattern?: string;
  };

  if (!tags && !pattern) {
    res.status(400).json({ error: "Provide 'tags' (array) or 'pattern' (string)" });
    return;
  }

  try {
    if (tags && tags.length > 0) {
      await invalidateTags(tags);
      logger.info({ tags }, "Cache invalidated via admin endpoint");
      res.json({ invalidated: "tags", tags });
      return;
    }

    if (pattern) {
      const count = await invalidatePattern(pattern);
      logger.info({ pattern, count }, "Cache invalidated via admin endpoint");
      res.json({ invalidated: "pattern", pattern, keysDeleted: count });
      return;
    }
  } catch (err) {
    logger.error({ err }, "Cache invalidation failed");
    res.status(500).json({ error: "Cache invalidation failed" });
  }
});

// POST /api/cache/purge — Purge all known caches (performers, recordings, stats, tags)
// Use after bulk data syncs or external data changes.
router.post("/cache/purge", ...admin, async (_req: Request, res: Response) => {
  try {
    const result = await purgeAllCache();
    res.json({
      purged: true,
      deletedKeys: result.deletedKeys,
      invalidatedTags: result.invalidatedTags,
      cdnPurged: result.cdnPurged,
    });
  } catch (err) {
    logger.error({ err }, "Cache purge failed");
    res.status(500).json({ error: "Cache purge failed" });
  }
});

// DELETE /api/cache/flush — Clear all cache (use with caution)
// purgeAllCache() already scans and deletes all api:* and tag:* keys
// from Redis, so no additional scanning is needed.
router.delete("/cache/flush", ...admin, async (_req: Request, res: Response) => {
  try {
    const result = await purgeAllCache();
    logger.info({ keysDeleted: result.deletedKeys }, "Cache flushed");
    res.json({ flushed: true, keysDeleted: result.deletedKeys, cdnPurged: result.cdnPurged });
  } catch (err) {
    logger.error({ err }, "Cache flush failed");
    res.status(500).json({ error: "Cache flush failed" });
  }
});

// GET /api/cache/metrics — Get detailed cache performance metrics
router.get("/cache/metrics", ...admin, async (_req: Request, res: Response) => {
  res.json(getCacheMetrics());
});

// POST /api/cache/metrics/reset — Reset cache metrics counters
router.post("/cache/metrics/reset", ...admin, async (_req: Request, res: Response) => {
  resetCacheMetrics();
  logger.info("Cache metrics reset");
  res.json({ reset: true });
});

// ─── Suggestion index ──────────────────────────────────────────────
// POST /api/cache/suggestions/rebuild — Rebuild the search suggestion index
// (performer/tag counts + recent recordings) into Redis.
router.post("/cache/suggestions/rebuild", ...admin, async (_req: Request, res: Response) => {
  try {
    const result = await buildSuggestionSnapshot();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Suggestion index rebuild failed");
    res.status(500).json({ error: "Suggestion index rebuild failed" });
  }
});

// ─── View buffer ───────────────────────────────────────────────────
// POST /api/cache/views/flush — Write all buffered view increments to Postgres
router.post("/cache/views/flush", ...admin, async (_req: Request, res: Response) => {
  try {
    const result = await flushPendingViews();
    logger.info({ result }, "View buffer flushed via admin endpoint");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "View buffer flush failed");
    res.status(500).json({ error: "View buffer flush failed" });
  }
});

// POST /api/cache/views/drop — DISCARD all buffered increments (danger)
router.post("/cache/views/drop", ...admin, async (_req: Request, res: Response) => {
  try {
    const deleted = await clearViewBuffer();
    logger.warn({ deleted }, "View buffer dropped via admin endpoint");
    res.json({ dropped: true, deletedKeys: deleted });
  } catch (err) {
    logger.error({ err }, "View buffer drop failed");
    res.status(500).json({ error: "View buffer drop failed" });
  }
});

// ─── Media Redis cache ─────────────────────────────────────────────
// POST /api/cache/media/clear — Drop every proxied image/transform/DNS/failure
router.post("/cache/media/clear", ...admin, async (_req: Request, res: Response) => {
  try {
    const deleted = await clearMediaRedisCache();
    logger.info({ deleted }, "Media Redis cache cleared via admin endpoint");
    res.json({ cleared: true, deletedKeys: deleted });
  } catch (err) {
    logger.error({ err }, "Media Redis cache clear failed");
    res.status(500).json({ error: "Media Redis cache clear failed" });
  }
});

// POST /api/cache/hot/clear — Drop trending ZSETs + meta hashes
router.post("/cache/hot/clear", ...admin, async (_req: Request, res: Response) => {
  try {
    const deleted = await clearHotCache();
    logger.info({ deleted }, "Hot cache cleared via admin endpoint");
    res.json({ cleared: true, deletedKeys: deleted });
  } catch (err) {
    logger.error({ err }, "Hot cache clear failed");
    res.status(500).json({ error: "Hot cache clear failed" });
  }
});

export default router;
