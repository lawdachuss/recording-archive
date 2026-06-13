import type { Request, Response, NextFunction } from "express";
import { getRedis, isRedisConnected } from "../lib/redis";
import { logger } from "../lib/logger";

// ─── In-flight Redis GET deduplication ────────────────────────────
// When multiple requests read the same cache key simultaneously,
// only one Redis GET executes; the rest share the same in-flight promise.
const inflightRedisMap = new Map<string, Promise<unknown>>();

function dedupeRedis<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflightRedisMap.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetcher().finally(() => {
    if (inflightRedisMap.get(key) === promise) {
      inflightRedisMap.delete(key);
    }
  });
  inflightRedisMap.set(key, promise);
  return promise;
}

// ─── In-flight request-level deduplication ─────────────────────────
// When multiple requests for the same URL miss cache simultaneously,
// only one executes the route handler (hits Supabase); the rest wait
// for it to finish and then serve from the cache it wrote.
//
// Key insight: the first request intercepts res.json() to both cache
// the response AND resolve the inflight promise. Waiting requests
// block on that promise, then retry the cache read — the first
// request will have written to cache by then.
const inflightReqMap = new Map<string, Promise<void>>();

function makeInflightKey(req: Request): string {
  return `${req.method}:${req.originalUrl}`;
}

// ─── Cache middleware factory ──────────────────────────────────────

interface CacheOptions {
  ttlSeconds: number;
  /** Optional cache tags for group invalidation (e.g. ["performers", "recordings"]) */
  tags?: string[];
  /** Only cache responses with these status codes (default: [200]) */
  cacheStatuses?: number[];
}

export function cache(options: number | CacheOptions) {
  const opts: CacheOptions =
    typeof options === "number" ? { ttlSeconds: options } : options;

  const {
    ttlSeconds,
    tags = [],
    cacheStatuses = [200],
  } = opts;

  return async (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", `public, max-age=0, must-revalidate`);

    const redis = getRedis();
    if (!redis || !isRedisConnected()) {
      next();
      return;
    }

    const cacheKey = `api:${req.originalUrl}`;

    // ── 1. Try cache hit (deduplicated Redis GET) ────────────
    try {
      const raw = await dedupeRedis(`read:${cacheKey}`, () => redis.get(cacheKey));

      if (raw) {
        const entry = JSON.parse(raw) as { body: unknown };
        res.type("json").send(entry.body);
        return;
      }
    } catch (err) {
      logger.error({ err, cacheKey }, "Cache read error, fetching fresh");
    }

    // ── 2. Check for in-flight request (another request already
    //       executing this route handler) ───────────────────────
    const inflightKey = makeInflightKey(req);
    const existingInflight = inflightReqMap.get(inflightKey);

    if (existingInflight) {
      // Another request is already fetching from the database.
      // Wait for it to complete (it will write to cache via res.json),
      // then try to serve from the cache it just wrote.
      await existingInflight;

      try {
        const raw = await redis.get(cacheKey);
        if (raw) {
          const entry = JSON.parse(raw) as { body: unknown };
          res.type("json").send(entry.body);
          return;
        }
      } catch {
        // Fall through — if retry fails, execute normally
      }

      // Edge case: the other request returned an error status that
      // wasn't cached. We'll execute normally (both hit DB).
      // This is acceptable since error responses are the rare path.
      next();
      return;
    }

    // ── 3. First request for this URL — set up inflight promise ─
    let resolveInflight: (() => void) | null = null;
    const inflightPromise = new Promise<void>((resolve) => {
      resolveInflight = resolve;
    });
    inflightReqMap.set(inflightKey, inflightPromise);

    // ── 4. Intercept res.json to cache AND resolve the promise ─
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const statusCode = res.statusCode;

      if (cacheStatuses.includes(statusCode)) {
        const entry = { body };

        redis
          .setex(cacheKey, ttlSeconds, JSON.stringify(entry))
          .catch((err) => logger.error({ err, cacheKey }, "Cache write error"));

        // Store tag → key references for group invalidation
        if (tags.length > 0) {
          for (const tag of tags) {
            redis.sadd(`tag:${tag}`, cacheKey).catch(() => {});
          }
        }
      }

      // Resolve the inflight promise so waiting requests can proceed
      if (resolveInflight) {
        resolveInflight();
        resolveInflight = null;
      }

      // Clean up the inflight map after a short delay so that
      // waiting requests have time to read the cache we just wrote
      setTimeout(() => {
        if (inflightReqMap.get(inflightKey) === inflightPromise) {
          inflightReqMap.delete(inflightKey);
        }
      }, 1000);

      return originalJson(body);
    };

    // Safety net: if a route handler sends a response via res.send(),
    // res.end(), or Express error middleware without calling res.json(),
    // this ensures the inflight promise doesn't orphan waiting requests.
    res.once("finish", () => {
      if (resolveInflight) {
        resolveInflight();
        resolveInflight = null;
        inflightReqMap.delete(inflightKey);
      }
    });

    next();
  };
}

// ─── Cache invalidation helpers ────────────────────────────────────

/**
 * Invalidate all cache entries tagged with the given tag names.
 * Also removes the tag sets themselves.
 */
export async function invalidateTags(tags: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;

  const keysToDelete = new Set<string>();

  for (const tag of tags) {
    const members = await redis.smembers(`tag:${tag}`);
    for (const key of members) keysToDelete.add(key);
    keysToDelete.add(`tag:${tag}`);
  }

  if (keysToDelete.size > 0) {
    await redis.del([...keysToDelete]);
    logger.info({ tags, keysDeleted: keysToDelete.size }, "Cache invalidated by tag");
  }
}

/**
 * Invalidate a specific cache key (prefixed with "api:" automatically).
 */
export async function invalidateKey(cacheKey: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;
  await redis.del(`api:${cacheKey}`);
}

/**
 * Delete all cache entries matching a glob pattern after "api:" prefix.
 * E.g. invalidatePattern("/performers*") clears all performer caches.
 * Returns the number of deleted keys.
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return 0;

  let cursor = "0";
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `api:${pattern}*`,
      "COUNT",
      100,
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      await redis.del(keys);
      deleted += keys.length;
    }
  } while (cursor !== "0");

  return deleted;
}

// ─── Auto-invalidation middleware for mutation routes ────────────
//
// Wraps a route handler to invalidate cache tags after a successful
// mutation response (2xx status). This ensures cached GET responses
// are evicted when the underlying data changes.
//
// Usage:
//   router.post("/resource", invalidateOnSuccess(["performers", "recordings"]), handler);
//
// The middleware intercepts res.json(), waits for the response,
// then invalidates the specified tags asynchronously.

export function invalidateOnSuccess(tags: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const statusCode = res.statusCode;

      // Trigger async invalidation on success responses
      if (statusCode >= 200 && statusCode < 300 && tags.length > 0) {
        invalidateTags(tags).catch((err) =>
          logger.error({ err, tags, originalUrl: req.originalUrl }, "Auto-invalidation failed"),
        );
      }

      return originalJson(body);
    };
    next();
  };
}

/**
 * Purge all known cache tag groups. Useful after bulk data syncs.
 * Invalidates: performers, recordings, stats, tags
 * Also deletes all cache entries matching "api:*" pattern.
 */
export async function purgeAllCache(): Promise<{ deletedKeys: number; invalidatedTags: number }> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) {
    return { deletedKeys: 0, invalidatedTags: 0 };
  }

  // Invalidate all known tag groups
  const allTags = ["performers", "recordings", "stats", "tags"];
  let tagKeysDeleted = 0;

  for (const tag of allTags) {
    const members = await redis.smembers(`tag:${tag}`);
    if (members.length > 0) {
      await redis.del([...members, `tag:${tag}`]);
      tagKeysDeleted += members.length + 1;
    } else {
      // Clean up empty tag sets
      await redis.del(`tag:${tag}`);
    }
  }

  // Also scan and delete any remaining api:* keys (safety net)
  let cursor = "0";
  let apiKeysDeleted = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "api:*", "COUNT", 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(keys);
      apiKeysDeleted += keys.length;
    }
  } while (cursor !== "0");

  logger.info(
    { tagKeysDeleted, apiKeysDeleted, tags: allTags },
    "Full cache purge completed",
  );

  return { deletedKeys: tagKeysDeleted + apiKeysDeleted, invalidatedTags: allTags.length };
}
