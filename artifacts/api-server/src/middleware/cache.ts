import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getRedis, isRedisConnected } from "../lib/redis";
import { logger } from "../lib/logger";

const CACHE_PREFIX = "api:v2";
const TAG_PREFIX = "tag:v2";
const DEFAULT_STALE_SECONDS = 60;
const DEFAULT_MEMORY_ENTRIES = 500;
const inflightRedisMap = new Map<string, Promise<unknown>>();
const inflightReqMap = new Map<string, Promise<void>>();

interface CacheOptions {
  ttlSeconds: number;
  tags?: string[];
  cacheStatuses?: number[];
  staleSeconds?: number;
}

interface CacheEntry {
  body: unknown;
  statusCode: number;
  etag: string;
  createdAt: number;
  expiresAt: number;
  staleUntil: number;
  tags: string[];
}

interface MemoryRecord {
  entry: CacheEntry;
  size: number;
}

const maxMemoryEntries = Math.max(
  50,
  Number.parseInt(process.env.API_CACHE_MEMORY_ENTRIES ?? "", 10) || DEFAULT_MEMORY_ENTRIES,
);

const memoryCache = new Map<string, MemoryRecord>();
const memoryTags = new Map<string, Set<string>>();

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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function makeEtag(body: unknown): string {
  const hash = createHash("sha256").update(stableStringify(body)).digest("base64url");
  return `"${hash.slice(0, 32)}"`;
}

function normalizeOriginalUrl(originalUrl: string): string {
  const [pathname, rawQuery = ""] = originalUrl.split("?", 2);
  if (!rawQuery) return pathname;

  const pairs = Array.from(new URLSearchParams(rawQuery).entries()).sort(([ak, av], [bk, bv]) => {
    const keyCompare = ak.localeCompare(bk);
    return keyCompare === 0 ? av.localeCompare(bv) : keyCompare;
  });
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function makeCacheKey(req: Request): string {
  return `${CACHE_PREFIX}:${normalizeOriginalUrl(req.originalUrl)}`;
}

function makeInflightKey(req: Request): string {
  return `${req.method}:${normalizeOriginalUrl(req.originalUrl)}`;
}

function setMemory(key: string, entry: CacheEntry): void {
  const serialized = JSON.stringify(entry);
  memoryCache.delete(key);
  memoryCache.set(key, { entry, size: serialized.length });

  for (const tag of entry.tags) {
    let keys = memoryTags.get(tag);
    if (!keys) {
      keys = new Set();
      memoryTags.set(tag, keys);
    }
    keys.add(key);
  }

  while (memoryCache.size > maxMemoryEntries) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    deleteMemory(oldestKey);
  }
}

function deleteMemory(key: string): void {
  const record = memoryCache.get(key);
  if (!record) return;

  memoryCache.delete(key);
  for (const tag of record.entry.tags) {
    const keys = memoryTags.get(tag);
    keys?.delete(key);
    if (keys?.size === 0) memoryTags.delete(tag);
  }
}

function getMemory(key: string): CacheEntry | null {
  const record = memoryCache.get(key);
  if (!record) return null;

  if (Date.now() > record.entry.staleUntil) {
    deleteMemory(key);
    return null;
  }

  memoryCache.delete(key);
  memoryCache.set(key, record);
  return record.entry;
}

function isFresh(entry: CacheEntry): boolean {
  return Date.now() <= entry.expiresAt;
}

function clientHasFreshCopy(req: Request, etag: string): boolean {
  const header = req.headers["if-none-match"];
  if (!header) return false;
  const values = Array.isArray(header) ? header : header.split(",");
  return values.map((value) => value.trim()).includes(etag);
}

function applyCacheHeaders(res: Response, entry: CacheEntry, ttlSeconds: number, staleSeconds: number): void {
  res.set({
    "Cache-Control": `public, max-age=0, must-revalidate, s-maxage=${ttlSeconds}, stale-while-revalidate=${staleSeconds}, stale-if-error=${staleSeconds}`,
    ETag: entry.etag,
    "X-Cache-TTL": String(Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000))),
  });
}

function sendEntry(
  req: Request,
  res: Response,
  entry: CacheEntry,
  source: "HIT" | "STALE" | "REFRESHED",
  ttlSeconds: number,
  staleSeconds: number,
): void {
  applyCacheHeaders(res, entry, ttlSeconds, staleSeconds);
  res.set("X-Cache", source);

  if (!isFresh(entry)) {
    res.set("Warning", '110 - "Response is stale"');
  }

  if (clientHasFreshCopy(req, entry.etag)) {
    res.status(304).end();
    return;
  }

  res.status(entry.statusCode).type("json").send(entry.body);
}

async function readRedis(cacheKey: string): Promise<CacheEntry | null> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return null;

  const raw = await dedupeRedis(`read:${cacheKey}`, () => redis.get(cacheKey));
  if (!raw || typeof raw !== "string") return null;

  const entry = JSON.parse(raw) as CacheEntry;
  if (Date.now() > entry.staleUntil) {
    redis.del(cacheKey).catch(() => {});
    return null;
  }

  setMemory(cacheKey, entry);
  return entry;
}

async function writeEntry(cacheKey: string, entry: CacheEntry, ttlSeconds: number, staleSeconds: number): Promise<void> {
  setMemory(cacheKey, entry);

  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;

  const redisTtl = Math.max(1, ttlSeconds + staleSeconds);
  await redis.setex(cacheKey, redisTtl, JSON.stringify(entry));

  if (entry.tags.length > 0) {
    const pipeline = redis.pipeline();
    for (const tag of entry.tags) {
      pipeline.sadd(`${TAG_PREFIX}:${tag}`, cacheKey);
      pipeline.expire(`${TAG_PREFIX}:${tag}`, redisTtl);
    }
    await pipeline.exec();
  }
}

async function readAny(cacheKey: string): Promise<CacheEntry | null> {
  const memoryEntry = getMemory(cacheKey);
  if (memoryEntry) return memoryEntry;

  try {
    return await readRedis(cacheKey);
  } catch (err) {
    logger.error({ err, cacheKey }, "Cache read error");
    return null;
  }
}

function shouldBypass(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return true;
  const cacheControl = String(req.headers["cache-control"] ?? "");
  return cacheControl.includes("no-store");
}

export function cache(options: number | CacheOptions) {
  const opts: CacheOptions =
    typeof options === "number" ? { ttlSeconds: options } : options;

  const ttlSeconds = Math.max(1, opts.ttlSeconds);
  const staleSeconds = Math.max(0, opts.staleSeconds ?? DEFAULT_STALE_SECONDS);
  const tags = opts.tags ?? [];
  const cacheStatuses = opts.cacheStatuses ?? [200];

  return async (req: Request, res: Response, next: NextFunction) => {
    if (shouldBypass(req)) {
      res.set("Cache-Control", "no-store");
      next();
      return;
    }

    const cacheKey = makeCacheKey(req);
    const existing = await readAny(cacheKey);

    if (existing && isFresh(existing)) {
      sendEntry(req, res, existing, "HIT", ttlSeconds, staleSeconds);
      return;
    }

    const inflightKey = makeInflightKey(req);
    const existingInflight = inflightReqMap.get(inflightKey);

    if (existingInflight) {
      if (existing) {
        sendEntry(req, res, existing, "STALE", ttlSeconds, staleSeconds);
        return;
      }

      await existingInflight;
      const refreshed = await readAny(cacheKey);
      if (refreshed) {
        sendEntry(req, res, refreshed, isFresh(refreshed) ? "REFRESHED" : "STALE", ttlSeconds, staleSeconds);
        return;
      }

      next();
      return;
    }

    let resolveInflight: (() => void) | null = null;
    const inflightPromise = new Promise<void>((resolve) => {
      resolveInflight = resolve;
    });
    inflightReqMap.set(inflightKey, inflightPromise);

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const statusCode = res.statusCode;
      let entryForResponse: CacheEntry | null = null;

      if (cacheStatuses.includes(statusCode)) {
        const now = Date.now();
        entryForResponse = {
          body,
          statusCode,
          etag: makeEtag(body),
          createdAt: now,
          expiresAt: now + ttlSeconds * 1000,
          staleUntil: now + (ttlSeconds + staleSeconds) * 1000,
          tags,
        };

        applyCacheHeaders(res, entryForResponse, ttlSeconds, staleSeconds);
        res.set("X-Cache", "MISS");

        writeEntry(cacheKey, entryForResponse, ttlSeconds, staleSeconds).catch((err) =>
          logger.error({ err, cacheKey }, "Cache write error"),
        );

        if (clientHasFreshCopy(req, entryForResponse.etag)) {
          if (resolveInflight) {
            resolveInflight();
            resolveInflight = null;
          }
          res.status(304).end();
          return res;
        }
      } else {
        res.set("Cache-Control", "no-store");
      }

      if (resolveInflight) {
        resolveInflight();
        resolveInflight = null;
      }

      setTimeout(() => {
        if (inflightReqMap.get(inflightKey) === inflightPromise) {
          inflightReqMap.delete(inflightKey);
        }
      }, 1000).unref?.();

      return originalJson(body);
    };

    res.once("finish", () => {
      if (resolveInflight) {
        resolveInflight();
        resolveInflight = null;
      }

      if (res.statusCode >= 500 && existing) {
        logger.warn({ cacheKey, statusCode: res.statusCode }, "Route failed while stale cache was available");
      }

      if (inflightReqMap.get(inflightKey) === inflightPromise) {
        inflightReqMap.delete(inflightKey);
      }
    });

    next();
  };
}

export async function invalidateTags(tags: string[]): Promise<void> {
  const redis = getRedis();
  const keysToDelete = new Set<string>();

  for (const tag of tags) {
    const memoryKeys = memoryTags.get(tag);
    for (const key of memoryKeys ?? []) keysToDelete.add(key);
    memoryTags.delete(tag);

    if (redis && isRedisConnected()) {
      const members = await redis.smembers(`${TAG_PREFIX}:${tag}`);
      for (const key of members) keysToDelete.add(key);
      keysToDelete.add(`${TAG_PREFIX}:${tag}`);
    }
  }

  for (const key of keysToDelete) {
    if (key.startsWith(CACHE_PREFIX)) deleteMemory(key);
  }

  if (redis && isRedisConnected() && keysToDelete.size > 0) {
    await redis.del([...keysToDelete]);
  }

  logger.info({ tags, keysDeleted: keysToDelete.size }, "Cache invalidated by tag");
}

export async function invalidateKey(cacheKey: string): Promise<void> {
  const normalizedKey = cacheKey.startsWith(CACHE_PREFIX)
    ? cacheKey
    : `${CACHE_PREFIX}:${normalizeOriginalUrl(cacheKey)}`;

  deleteMemory(normalizedKey);

  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;
  await redis.del(normalizedKey);
}

function patternCandidates(pattern: string): string[] {
  const normalized = pattern.startsWith("/") ? pattern : `/${pattern}`;
  const withoutApi = normalized.startsWith("/api/") ? normalized.slice(4) : normalized;
  const withApi = withoutApi.startsWith("/api/") ? withoutApi : `/api${withoutApi}`;
  return [`${CACHE_PREFIX}:${withoutApi}*`, `${CACHE_PREFIX}:${withApi}*`];
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export async function invalidatePattern(pattern: string): Promise<number> {
  const candidates = patternCandidates(pattern);
  const regexes = candidates.map(wildcardToRegExp);
  const keysToDelete = new Set<string>();

  for (const key of memoryCache.keys()) {
    if (regexes.some((regex) => regex.test(key))) keysToDelete.add(key);
  }

  const redis = getRedis();
  if (redis && isRedisConnected()) {
    for (const candidate of candidates) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", candidate, "COUNT", 100);
        cursor = nextCursor;
        for (const key of keys) keysToDelete.add(key);
      } while (cursor !== "0");
    }
  }

  for (const key of keysToDelete) deleteMemory(key);

  if (redis && isRedisConnected() && keysToDelete.size > 0) {
    await redis.del([...keysToDelete]);
  }

  return keysToDelete.size;
}

export function invalidateOnSuccess(tags: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const statusCode = res.statusCode;

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

export async function purgeAllCache(): Promise<{ deletedKeys: number; invalidatedTags: number }> {
  const redis = getRedis();
  const invalidatedTags = new Set(memoryTags.keys());
  let deletedKeys = memoryCache.size + memoryTags.size;

  memoryCache.clear();
  memoryTags.clear();

  if (redis && isRedisConnected()) {
    for (const match of [`${CACHE_PREFIX}:*`, `${TAG_PREFIX}:*`, "api:*", "tag:*"]) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", match, "COUNT", 200);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(keys);
          deletedKeys += keys.length;
          for (const key of keys) {
            if (key.startsWith(`${TAG_PREFIX}:`)) invalidatedTags.add(key.slice(TAG_PREFIX.length + 1));
          }
        }
      } while (cursor !== "0");
    }
  }

  logger.info({ deletedKeys, invalidatedTags: invalidatedTags.size }, "Full cache purge completed");
  return { deletedKeys, invalidatedTags: invalidatedTags.size };
}

export function getCacheStats(): {
  memoryEntries: number;
  memoryBytes: number;
  memoryTags: number;
  maxMemoryEntries: number;
} {
  let memoryBytes = 0;
  for (const record of memoryCache.values()) memoryBytes += record.size;

  return {
    memoryEntries: memoryCache.size,
    memoryBytes,
    memoryTags: memoryTags.size,
    maxMemoryEntries,
  };
}
