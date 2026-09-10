import { Router } from "express";
import { getRedis, isRedisConnected } from "../lib/redis.js";

/**
 * edge-cache.ts — shared cross-device cache for the frontend's Tier-0 cache
 * layer (artifacts/video-archive/src/lib/cache.ts).
 *
 * Serves the same JSON contract the frontend expects from its edge-cache URL
 * (VITE_EDGE_CACHE_URL), backed by Redis:
 *
 *   GET    /cache?key=<key>     → { exists, value?, ttl? }   (ttl in seconds)
 *   POST   /cache { key, value, ttl? } → { success }         (ttl in seconds)
 *   DELETE /cache?key=<key>     → { success }
 *
 * The site runs self-hosted Supabase, so the original design (a hosted
 * Supabase edge function at /functions/v1/cache) isn't deployable. This
 * endpoint replaces it with the API server the site already deploys: same
 * contract, same-origin (no CORS), and Redis provides the cross-device
 * sharing that made the tier useful. GET responses carry a short s-maxage so
 * Vercel's CDN serves repeat reads from the nearest edge POP, giving the tier
 * its "edge" property.
 *
 * Degrades gracefully: when Redis is unavailable the GET returns a miss and
 * the POST/DELETE return success:false, so the frontend's local tiers keep
 * working untouched.
 */

const PREFIX = "edge:";
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — matches the supabase/functions/cache design
const MAX_VALUE_BYTES = 250_000;
// Cap CDN caching of GET responses so a cross-device write propagates within
// minutes rather than the key's full TTL.
const MAX_CDN_TTL_SECONDS = 300;

interface EdgeEntry {
  value: unknown;
  expiresAt: number | null;
}

const router = Router();

router.get("/cache", async (req, res) => {
  const key = String(req.query.key ?? "");
  if (!key) {
    res.status(400).json({ error: "key query parameter required" });
    return;
  }

  const redis = getRedis();
  if (!redis || !isRedisConnected()) {
    res.setHeader("Cache-Control", "no-store");
    res.json({ exists: false, value: null, ttl: null });
    return;
  }

  try {
    const raw = await redis.get(PREFIX + key);
    if (!raw) {
      // A miss must never be cached by the CDN: a cached { exists: false }
      // would keep serving a miss for up to MAX_CDN_TTL_SECONDS after a
      // POST writes the key.
      res.setHeader("Cache-Control", "no-store");
      res.json({ exists: false, value: null, ttl: null });
      return;
    }
    const entry = JSON.parse(raw) as EdgeEntry;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      // Expired — prune lazily and report a miss (also uncacheable).
      redis.del(PREFIX + key).catch(() => {});
      res.setHeader("Cache-Control", "no-store");
      res.json({ exists: false, value: null, ttl: null });
      return;
    }
    const ttl =
      entry.expiresAt === null
        ? null
        : Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
    const cdnTtl = ttl === null ? MAX_CDN_TTL_SECONDS : Math.min(ttl, MAX_CDN_TTL_SECONDS);
    res.setHeader(
      "Cache-Control",
      `public, max-age=0, must-revalidate, s-maxage=${cdnTtl}`,
    );
    res.json({ exists: true, value: entry.value, ttl });
  } catch (err) {
    req.log.error({ err, key }, "Edge cache GET error");
    res.status(500).json({ error: "cache read failed" });
  }
});

router.post("/cache", async (req, res) => {
  const body = (req.body ?? {}) as { key?: unknown; value?: unknown; ttl?: unknown };
  if (typeof body.key !== "string" || body.key.length === 0) {
    res.status(400).json({ error: "body must be { key, value, ttl? }" });
    return;
  }
  if (body.value === undefined || body.value === null) {
    res.status(400).json({ error: "value is required" });
    return;
  }

  const rawTtl = Number(body.ttl);
  const ttlSec =
    Number.isFinite(rawTtl) && rawTtl > 0
      ? Math.max(1, Math.min(MAX_TTL_SECONDS, Math.round(rawTtl)))
      : null;

  const serialized = JSON.stringify(body.value);
  if (serialized.length > MAX_VALUE_BYTES) {
    res.status(413).json({ error: "value too large" });
    return;
  }

  const redis = getRedis();
  if (!redis || !isRedisConnected()) {
    res.json({ success: false });
    return;
  }

  try {
    const entry: EdgeEntry = {
      value: body.value,
      expiresAt: ttlSec === null ? null : Date.now() + ttlSec * 1000,
    };
    const payload = JSON.stringify(entry);
    if (ttlSec === null) {
      await redis.set(PREFIX + body.key, payload);
    } else {
      await redis.setex(PREFIX + body.key, ttlSec, payload);
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err, key: body.key }, "Edge cache POST error");
    res.status(500).json({ error: "cache write failed" });
  }
});

router.delete("/cache", async (req, res) => {
  const key = String(req.query.key ?? "");
  if (!key) {
    res.status(400).json({ error: "key query parameter required" });
    return;
  }

  const redis = getRedis();
  if (!redis || !isRedisConnected()) {
    res.json({ success: false });
    return;
  }

  try {
    await redis.del(PREFIX + key);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err, key }, "Edge cache DELETE error");
    res.status(500).json({ error: "cache delete failed" });
  }
});

export default router;