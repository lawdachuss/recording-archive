import { Router, type IRouter, type Request, type Response } from "express";
import { getRedis, isRedisConnected, getRedisStatus } from "../lib/redis";
import { invalidateTags, invalidatePattern, purgeAllCache } from "../middleware/cache";
import { requireRole } from "../middleware/requireRole";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const admin = requireRole("admin");

// GET /api/cache/status — Check cache status
router.get("/cache/status", ...admin, async (_req: Request, res: Response) => {
  const redis = getRedis();
  const status = getRedisStatus();
  const connected = isRedisConnected();

  let info: Record<string, unknown> = { connected, status };

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
    });
  } catch (err) {
    logger.error({ err }, "Cache purge failed");
    res.status(500).json({ error: "Cache purge failed" });
  }
});

// DELETE /api/cache/flush — Clear all cache (use with caution)
router.delete("/cache/flush", ...admin, async (_req: Request, res: Response) => {
  const redis = getRedis();
  if (!redis) {
    res.status(503).json({ error: "Redis not available" });
    return;
  }

  try {
    // Only delete keys matching our prefix
    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "api:*", "COUNT", 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");

    // Also delete tag sets
    cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "tag:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");

    logger.info({ keysDeleted: deleted }, "Cache flushed");
    res.json({ flushed: true, keysDeleted: deleted });
  } catch (err) {
    logger.error({ err }, "Cache flush failed");
    res.status(500).json({ error: "Cache flush failed" });
  }
});

export default router;
