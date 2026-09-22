// media-cache.ts — shared Redis tier for the media proxy.
//
// The proxy currently keeps image buffers, server-side resized variants, DNS
// answers and upstream-failure markers in per-instance memory only. On a
// cold-start / CDN-miss that memory is empty, so the first thumbnails of every
// page re-fetch from pixhost/catbox — the exact serialization that made first
// paint slow. This module mirrors those in-memory caches into shared Redis with
// matching TTLs, so:
//   - any warm instance can serve blobs another instance already fetched,
//   - a big burst (grid + catalog warmer + hover preload) coalesces in Redis,
//   - the Vercel CDN miss falls back to a Redis hit instead of an upstream hit.
//
// Everything FAILS OPEN: no Redis → every getter returns null and every setter
// is a no-op, exactly as before this module existed. Blobs larger than
// MAX_REDIS_BLOB_BYTES are kept memory-only so juicy 2MB thumbnails don't bloat
// the shared cache and stall the (possibly public-tunnel) connection.

import { createHash } from "node:crypto";
import { logger } from "./logger.js";
import { getRedis, isRedisConnected } from "./redis.js";

export const MEDIA_REDIS_PREFIX = "media:";

export interface MediaImage {
  buffer: Buffer;
  contentType: string;
  status: number;
}

export interface MediaTransform {
  buffer: Buffer;
  contentType: string;
}

// ─── Configuration ────────────────────────────────────────────────
// TTLs mirror the in-memory tiers in media-proxy.ts exactly, so a Redis entry
// never outlives the memory entry it mirrors. Sizing caps keep the shared
// cache (and the tunnel to it) from being a bottleneck of its own.
const IMG_TTL_SECONDS = 5 * 60;
const TX_TTL_SECONDS = 30 * 60;
const DNS_TTL_SECONDS = 5 * 60;
const FAIL_TTL_SECONDS = 10 * 60;
const MAX_REDIS_BLOB_BYTES = 1_500 * 1024; // ~1.5MB

const IMG_KEY = `${MEDIA_REDIS_PREFIX}img:v1:`;
const TX_KEY = `${MEDIA_REDIS_PREFIX}tx:v1:`;
const DNS_KEY = `${MEDIA_REDIS_PREFIX}dns:v1:`;
const FAIL_KEY = `${MEDIA_REDIS_PREFIX}fail:v1:`;

// ─── Low-level helpers (fail-open) ─────────────────────────────────

function hashKey(prefix: string, value: string): string {
  // URLs/keys can be long; hash keeps Redis keys bounded and avoids colon
  // collisions inside the value. Collisions are theoretically possible but
  // astronomically unlikely for a 160-bit fingerprint.
  return `${prefix}${createHash("sha1").update(value).digest("hex")}`;
}

async function getString(key: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return null;
  try {
    const raw = await redis.get(key);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch (err) {
    logger.warn({ err, key }, "Media Redis read error");
    return null;
  }
}

async function setString(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;
  try {
    await redis.setex(key, Math.max(1, Math.floor(ttlSeconds)), value);
  } catch (err) {
    logger.warn({ err, key }, "Media Redis write error");
  }
}

async function deletePattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return 0;
  let deleted = 0;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        const count = await redis.del(keys);
        deleted += count;
      }
    } while (cursor !== "0");
  } catch (err) {
    logger.warn({ err, pattern }, "Media Redis clear error");
  }
  return deleted;
}

// ─── Image / transform blobs ───────────────────────────────────────

export async function getImageFromRedis(url: string): Promise<MediaImage | null> {
  const raw = await getString(hashKey(IMG_KEY, url));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { b64: string; contentType: string; status: number };
    if (typeof parsed.b64 !== "string" || parsed.b64.length === 0) return null;
    return {
      buffer: Buffer.from(parsed.b64, "base64"),
      contentType: parsed.contentType ?? "image/jpeg",
      status: parsed.status ?? 200,
    };
  } catch {
    return null;
  }
}

export function setImageInRedis(url: string, img: MediaImage): void {
  if (img.buffer.length > MAX_REDIS_BLOB_BYTES) return;
  const payload = JSON.stringify({
    b64: img.buffer.toString("base64"),
    contentType: img.contentType,
    status: img.status,
  });
  setString(hashKey(IMG_KEY, url), payload, IMG_TTL_SECONDS).catch(() => {});
}

export async function getTransformFromRedis(key: string): Promise<MediaTransform | null> {
  const raw = await getString(hashKey(TX_KEY, key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { b64: string; contentType: string };
    if (typeof parsed.b64 !== "string" || parsed.b64.length === 0) return null;
    return {
      buffer: Buffer.from(parsed.b64, "base64"),
      contentType: parsed.contentType ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}

export function setTransformInRedis(key: string, img: MediaTransform): void {
  if (img.buffer.length > MAX_REDIS_BLOB_BYTES) return;
  const payload = JSON.stringify({
    b64: img.buffer.toString("base64"),
    contentType: img.contentType,
  });
  setString(hashKey(TX_KEY, key), payload, TX_TTL_SECONDS).catch(() => {});
}

// ─── DNS cache ─────────────────────────────────────────────────────

export async function getDnsFromRedis(hostname: string): Promise<string | null> {
  return getString(hashKey(DNS_KEY, hostname));
}

export function setDnsInRedis(hostname: string, ip: string): void {
  setString(hashKey(DNS_KEY, hostname), ip, DNS_TTL_SECONDS).catch(() => {});
}

// ─── Failure cache ─────────────────────────────────────────────────

export async function isFailureInRedis(url: string): Promise<boolean> {
  return (await getString(hashKey(FAIL_KEY, url))) !== null;
}

export function markFailureInRedis(url: string): void {
  setString(hashKey(FAIL_KEY, url), String(Date.now()), FAIL_TTL_SECONDS).catch(() => {});
}

// ─── Admin / cleanup ───────────────────────────────────────────────

/** Delete all media-proxy Redis entries. Called by cache-admin / cache purge. */
export async function clearMediaRedisCache(): Promise<number> {
  const patterns = ["media:img:v1:*", "media:tx:v1:*", "media:dns:v1:*", "media:fail:v1:*"];
  let deleted = 0;
  for (const pattern of patterns) {
    deleted += await deletePattern(pattern);
  }
  if (deleted > 0) logger.info({ deleted }, "Media Redis cache cleared");
  return deleted;
}

/** Rough per-keyspace key counts for cache-admin status output. */
export async function getMediaRedisStats(): Promise<Record<string, number>> {
  const redis = getRedis();
  const stats: Record<string, number> = {};
  if (!redis || !isRedisConnected()) return stats;
  try {
    for (const [name, pattern] of [
      ["images", "media:img:v1:*"],
      ["transforms", "media:tx:v1:*"],
      ["dns", "media:dns:v1:*"],
      ["failures", "media:fail:v1:*"],
    ] as const) {
      let count = 0;
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
        cursor = nextCursor;
        count += keys.length;
      } while (cursor !== "0");
      stats[name] = count;
    }
  } catch (err) {
    logger.warn({ err }, "Media Redis stats error");
  }
  return stats;
}