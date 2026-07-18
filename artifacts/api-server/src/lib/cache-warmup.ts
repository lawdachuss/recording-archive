import { logger } from "./logger.js";
import { getRedis, isRedisConnected } from "./redis.js";
import { purgeAllCache } from "../middleware/cache.js";

// ─── Configuration ─────────────────────────────────────────────────
// Ordered by priority — the most-visited routes are warmed first.
// Routes higher in the list are fetched before lower ones.
const WARMUP_ROUTES: { path: string; priority: number }[] = [
  // Tier 1 — homepage essentials (highest priority)
  { path: "/api/stats", priority: 1 },
  { path: "/api/tags", priority: 1 },
  { path: "/api/performers", priority: 1 },
  { path: "/api/recordings?limit=12&sort=newest", priority: 1 },
  { path: "/api/recordings?limit=12&sort=popular", priority: 1 },

  // Tier 2 — browse/discovery
  { path: "/api/performers?sort=count&limit=24", priority: 2 },
  { path: "/api/performers?sort=name&limit=24", priority: 2 },
];

/**
 * Wait up to `timeoutMs` for Redis to be connected.
 * Returns true if Redis connected, false on timeout.
 */
async function waitForRedis(timeoutMs: number): Promise<boolean> {
  if (isRedisConnected()) return true;

  const pollInterval = 200;
  const maxAttempts = Math.ceil(timeoutMs / pollInterval);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));
    if (isRedisConnected()) return true;
  }

  return false;
}

interface WarmupResult {
  total: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  failedRoutes: { path: string; status: number }[];
}

/**
 * Warm up the cache by hitting popular API routes so that
 * the first real user requests get served from Redis instead
 * of hitting the database.
 *
 * Call this after the server starts listening:
 *
 *   app.listen(port, () => {
 *     warmupCache(port).catch(() => {});
 *   });
 *
 * It runs entirely in the background — errors are logged but
 * never crash the server.
 */
export async function warmupCache(port: number): Promise<WarmupResult> {
  // Wait briefly for Redis to connect (lazyConnect is enabled)
  // If Redis doesn't connect within 5s, the warmup still fires — the
  // cache middleware will handle Redis being unavailable gracefully.
  await waitForRedis(5000);

  const start = Date.now();
  const baseUrl = `http://127.0.0.1:${port}`;
  const failedRoutes: { path: string; status: number }[] = [];
  let succeeded = 0;
  let total = 0;

  logger.info({ routeCount: WARMUP_ROUTES.length }, "Cache warmup starting");

  // Warm routes in priority order (lower number = higher priority)
  const sortedRoutes = [...WARMUP_ROUTES].sort((a, b) => a.priority - b.priority);

  for (const { path } of sortedRoutes) {
    // Skip duplicate paths that have already been warmed
    const url = `${baseUrl}${path}`;
    total++;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (response.ok) {
        succeeded++;
      } else {
        failedRoutes.push({ path, status: response.status });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failedRoutes.push({ path, status: 0 });
      logger.error({ err: message, path }, "Cache warmup request failed");
    }
  }

  // If tier 3 (performer details) was queued, fetch the
  // top 5 performers' profile pages to warm them too
  try {
    const perfResponse = await fetch(`${baseUrl}/api/performers?limit=5&sort=count`, {
      headers: { Accept: "application/json" },
    });
    if (perfResponse.ok) {
      const data = (await perfResponse.json()) as {
        performers?: { username: string }[];
      };
      const topPerformers = data.performers ?? [];
      const perfPromises = topPerformers.map(async (p) => {
        total++;
        try {
          const res = await fetch(`${baseUrl}/api/performers/${encodeURIComponent(p.username)}`, {
            headers: { Accept: "application/json" },
          });
          if (res.ok) succeeded++;
          else failedRoutes.push({ path: `/api/performers/${p.username}`, status: res.status });
        } catch {
          failedRoutes.push({ path: `/api/performers/${p.username}`, status: 0 });
        }
      });
      await Promise.allSettled(perfPromises);
    }
  } catch {
    // Non-critical — this step is best-effort
  }

  const durationMs = Date.now() - start;

  if (failedRoutes.length > 0) {
    logger.warn(
      {
        succeeded,
        failed: failedRoutes.length,
        total,
        durationMs,
        failedRoutes: failedRoutes.slice(0, 5),
      },
      "Cache warmup completed with some failures — purging all cache entries",
    );

    // Purge the entire cache so no stale or partial data is served
    // to users. The cache will be repopulated on the next real request.
    purgeAllCache().catch((err) =>
      logger.error({ err }, "Failed to purge cache after warmup failures"),
    );
  } else {
    logger.info({ succeeded, total, durationMs }, "Cache warmup completed successfully");

    // If only a subset of routes were warmed (no failures), skip invalidation.
    // The cache entries are fresh from the warmup.
    //
    // If the warmup was skipped entirely (all routes skipped), no cache
    // entries were written, so no invalidation needed.
  }

  return { total, succeeded, failed: failedRoutes.length, durationMs, failedRoutes };
}
