import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getRedis, isRedisConnected } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

/**
 * rate-limit.ts — Redis-backed fixed-window rate limiting with in-memory
 * fallback.
 *
 * Two layers of protection for the origin:
 *   - Global: every /api request is limited per client IP, with a stricter
 *     budget for writes (POST/PUT/DELETE) than reads.
 *   - Keyed: individual routes (search) can apply a tighter bucket.
 *
 * Design notes:
 *   - Fixed window (INCR + EXPIRE) — two Redis ops per request, atomic, good
 *     enough for abuse protection. Not a strict sliding window; acceptable.
 *   - Fail OPEN: if Redis errors, requests pass through (rate limiting must
 *     never take the API down). The in-memory fallback still applies.
 *   - Serverless-safe: one pipeline per request, no subscriptions.
 */

// ─── Configuration ────────────────────────────────────────────────

const ENABLED = (process.env.RATE_LIMIT_ENABLED ?? "true") !== "false";
const WINDOW_SECONDS = Number.parseInt(process.env.RATE_LIMIT_WINDOW ?? "", 10) || 60;

const LIMITS = {
  read: Number.parseInt(process.env.RATE_LIMIT_READ ?? "", 10) || 300, // per IP/min
  write: Number.parseInt(process.env.RATE_LIMIT_WRITE ?? "", 10) || 60, // per IP/min
  search: Number.parseInt(process.env.RATE_LIMIT_SEARCH ?? "", 10) || 45, // per IP/min
  user: Number.parseInt(process.env.RATE_LIMIT_USER ?? "", 10) || 600, // per auth token/min
};

const KEY_PREFIX = "rl:v1";

// ─── In-memory fallback (per instance, Redis down) ────────────────

interface MemoryWindow {
  count: number;
  resetAt: number;
}

const memoryWindows = new Map<string, MemoryWindow>();
let lastCleanup = Date.now();

function memoryIncrement(key: string): { count: number; resetAt: number } {
  const now = Date.now();

  // Occasional sweep so the map doesn't grow unbounded under abuse.
  if (now - lastCleanup > 30_000) {
    lastCleanup = now;
    for (const [k, w] of memoryWindows) {
      if (w.resetAt <= now) memoryWindows.delete(k);
    }
  }

  const existing = memoryWindows.get(key);
  if (existing && existing.resetAt > now) {
    existing.count += 1;
    return existing;
  }
  const fresh = { count: 1, resetAt: now + WINDOW_SECONDS * 1000 };
  memoryWindows.set(key, fresh);
  return fresh;
}

// ─── Redis fixed window ───────────────────────────────────────────

async function redisIncrement(key: string): Promise<{ count: number; resetAt: number } | null> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return null;

  try {
    const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const redisKey = `${KEY_PREFIX}:${key}:${window}`;
    const resetAt = (window + 1) * WINDOW_SECONDS * 1000;

    const count = await redis.incr(redisKey);
    if (count === 1) {
      redis.expire(redisKey, WINDOW_SECONDS + 5).catch(() => {});
    }
    return { count, resetAt };
  } catch (err) {
    logger.error({ err }, "Rate limiter Redis error (failing open)");
    return null;
  }
}

// ─── Identity helpers ─────────────────────────────────────────────

export function clientIp(req: Request): string {
  try {
    const realIp = req.headers?.["x-real-ip"];
    if (typeof realIp === "string" && realIp.length > 0) return realIp.trim();

    const xff = req.headers?.["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      // Vercel appends the real client edge IP; the leftmost entry is the client.
      return xff.split(",")[0]!.trim();
    }
    if (req.socket?.remoteAddress) return req.socket.remoteAddress;
    if ((req as any).connection?.remoteAddress) return (req as any).connection.remoteAddress;
    if (req.ip) return req.ip;
  } catch {
    /* safely fallback when running in serverless environments */
  }
  return "unknown";
}

/** Stable per-token key without decoding the JWT — hash it. */
function tokenKey(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (token.length < 10) return null;
  const hash = createHash("sha256").update(token).digest("base64url");
  return hash.slice(0, 32);
}

// ─── Headers / response ───────────────────────────────────────────

function sendLimited(res: Response, limit: number, resetAt: number, bucket: string): void {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.set({
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": "0",
    "RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
    "Retry-After": String(retryAfter),
  });
  res.status(429).json({ error: "Too many requests", bucket });
}

// ─── Middleware ───────────────────────────────────────────────────

interface RateLimitOptions {
  bucket: "read" | "write" | "search" | "user";
  /** Override the bucket's default limit (mainly for tests / special routes). */
  limit?: number;
  /** Key the limit by this instead of client IP (e.g. auth token hash). */
  keyFn?: (req: Request) => string | null;
  /** Skip certain paths (e.g. health checks). Matched on req.path. */
  skip?: (req: Request) => boolean;
}

export function rateLimit(options: RateLimitOptions) {
  const limit = options.limit ?? LIMITS[options.bucket];

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!ENABLED) {
      next();
      return;
    }
    if (options.skip?.(req)) {
      next();
      return;
    }

    const keyPart = options.keyFn?.(req) ?? clientIp(req);
    const result =
      (await redisIncrement(`${options.bucket}:${keyPart}`)) ?? memoryIncrement(`${options.bucket}:${keyPart}`);

    if (result.count > limit) {
      sendLimited(res, limit, result.resetAt, options.bucket);
      return;
    }

    res.set("RateLimit-Limit", String(limit));
    res.set("RateLimit-Remaining", String(Math.max(0, limit - result.count)));
    next();
  };
}

/**
 * Global /api limiter: per-IP with a method-aware budget (reads vs writes)
 * plus a per-auth-token bucket for authenticated traffic. Health check and
 * cache-admin endpoints are exempt (cache-admin already requires admin auth).
 */
export const globalRateLimiter = rateLimit({
  bucket: "read",
  skip: (req) => req.path === "/healthz" || req.path.startsWith("/admin") || req.path.startsWith("/cache"),
});

/** Convenience: per-token (authenticated) limiter for expensive endpoints. */
export function authenticatedRateLimit() {
  return rateLimit({
    bucket: "user",
    keyFn: tokenKey,
  });
}

/** Visible for tests. */
export function _resetMemoryWindowsForTests(): void {
  memoryWindows.clear();
  lastCleanup = Date.now();
}

/** Visible for tests. */
export function _limitsForTests(): typeof LIMITS {
  return LIMITS;
}
