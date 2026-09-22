import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getRedis, isRedisConnected, redisPublish, redisSubscribe, type PubSubSubscription } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

const CACHE_PREFIX = "api:v2";
const TAG_PREFIX = "tag:v2";
const DEFAULT_STALE_SECONDS = 60;
const DEFAULT_MEMORY_ENTRIES = 500;
const INFLOW_TIMEOUT_MS = Number.parseInt(process.env.API_CACHE_INFLOW_TIMEOUT ?? "", 10) || 10_000;
const inflightRedisMap = new Map<string, Promise<unknown>>();
const inflightReqMap = new Map<string, Promise<void>>();

// ─── Invalidation epochs ───────────────────────────────────────────
// Guards against the ghost-refill race: an admin invalidate/purge that runs
// WHILE a request is already executing from the origin could have its (pre-
// invalidation) response written back into the cache right after the delete,
// un-invalidating the delete. Each invalidation stamps a monotonic epoch;
// writeEntry refuses to persist entries whose createdAt (set when the origin
// handler called res.json) predates a matching invalidation.
const MAX_KEY_EPOCHS = 5000;
let epochCounter = 0;
let purgeEpoch = 0; // stamped by pattern invalidation and full purges
const tagInvalidationEpoch = new Map<string, number>();
const keyInvalidationEpoch = new Map<string, number>();

function stampEpoch(): number {
  return ++epochCounter;
}

function wasInvalidatedAfter(cacheKey: string, entry: CacheEntry): boolean {
  // The response may contain data fetched before the invalidation, so compare
  // against the epoch captured when the request STARTED (entry.fillEpoch), not
  // when res.json happened to run. Legacy entries predate the field — without
  // a start epoch there is nothing safe to compare, so don't block them.
  const fillEpoch = entry.fillEpoch;
  if (fillEpoch === undefined) return false;
  if (purgeEpoch > fillEpoch) return true;
  const keyEpoch = keyInvalidationEpoch.get(cacheKey);
  if (keyEpoch !== undefined && fillEpoch < keyEpoch) return true;
  for (const tag of entry.tags) {
    const tagEpoch = tagInvalidationEpoch.get(tag);
    if (tagEpoch !== undefined && fillEpoch < tagEpoch) return true;
  }
  return false;
}

function rememberKeyInvalidation(cacheKey: string): void {
  keyInvalidationEpoch.set(cacheKey, stampEpoch());
  if (keyInvalidationEpoch.size > MAX_KEY_EPOCHS) {
    // Cap growth: evict the OLDEST stamp first (Map iterates in insertion
    // order). Repeatedly-invalidated keys are re-stamped so they stay; only
    // long-forgotten keys fall off, and their fills are no longer capable of
    // racing an invalidation that happened long ago.
    for (const oldest of keyInvalidationEpoch.keys()) {
      keyInvalidationEpoch.delete(oldest);
      break;
    }
  }
}

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
  /** Epoch counter value when the request that produced this entry STARTED. */
  fillEpoch?: number;
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

// ─── Cache Metrics ────────────────────────────────────────────────

interface CacheMetrics {
  hits: number;
  misses: number;
  staleServes: number;
  inflightCoalesced: number;
  inflightTimeouts: number;
  bytesServed: number;
  startTime: number;
}

const metrics: CacheMetrics = {
  hits: 0,
  misses: 0,
  staleServes: 0,
  inflightCoalesced: 0,
  inflightTimeouts: 0,
  bytesServed: 0,
  startTime: Date.now(),
};

function trackMetric<K extends keyof CacheMetrics>(key: K, value?: CacheMetrics[K]): void {
  if (value !== undefined) {
    (metrics[key] as number) += value as number;
  } else {
    (metrics[key] as number)++;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

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
  // For large bodies (>10KB), use a fast MD5 fingerprint instead of
  // expensive stableStringify + SHA-256. This is safe because the ETag
  // only needs to change when the response body changes — the cache entry's
  // own timestamps handle staleness.
  const json = JSON.stringify(body);
  if (json.length > 10_000) {
    const hash = createHash("md5").update(json).digest("base64url");
    return `"${hash.slice(0, 24)}"`;
  }
  const hash = createHash("sha256").update(stableStringify(body)).digest("base64url");
  return `"${hash.slice(0, 32)}"`;
}

// ─── Cache-key normalization ──────────────────────────────────────
// Only known, meaningful query params may differentiate cache entries.
// Everything else (tracking junk, cache-busting noise like ?t=1234567)
// is dropped, so attackers/bots can't multiply origin load with random
// query strings. Params not in this list are still passed to the route
// handler — they only stop participating in the cache identity.
const CACHEABLE_QUERY_PARAMS = new Set([
  "page",
  "limit",
  "search",
  "q",
  "query",
  "tags",
  "tag",
  "gender",
  "username",
  "resolution",
  "sort",
  "order",
  "platform",
  "id",
  "recording_id",
  "performer",
  "status",
  "type",
  "url",
  "w",
  "fmt",
  "format",
  "offset",
]);

function normalizeOriginalUrl(originalUrl: string): string {
  const [pathname, rawQuery = ""] = originalUrl.split("?", 2);
  if (!rawQuery) return pathname;

  const pairs = Array.from(new URLSearchParams(rawQuery).entries())
    .filter(([key]) => CACHEABLE_QUERY_PARAMS.has(key))
    .sort(([ak, av], [bk, bv]) => {
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

// ─── Memory Cache ─────────────────────────────────────────────────

function setMemory(key: string, entry: CacheEntry): void {
  // Clean up old tag references before adding new ones to prevent
  // phantom mappings when the tag set changes between writes.
  const oldRecord = memoryCache.get(key);
  if (oldRecord) {
    for (const tag of oldRecord.entry.tags) {
      const keys = memoryTags.get(tag);
      keys?.delete(key);
      if (keys?.size === 0) memoryTags.delete(tag);
    }
  }

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

// ─── Freshness / ETag ─────────────────────────────────────────────

function isFresh(entry: CacheEntry): boolean {
  return Date.now() <= entry.expiresAt;
}

function clientHasFreshCopy(req: Request, etag: string): boolean {
  const header = req.headers["if-none-match"];
  if (!header) return false;
  const values = Array.isArray(header) ? header : header.split(",");
  return values.map((value) => value.trim()).includes(etag);
}

// ─── Response Helpers ─────────────────────────────────────────────

function applyCacheHeaders(res: Response, entry: CacheEntry, staleSeconds: number): void {
  const remainingSeconds = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  // s-maxage must reflect the entry's REMAINING freshness, not the route's
  // configured TTL. A stale/expired entry is advertised with s-maxage=0 so the
  // Vercel CDN must revalidate the origin instead of caching a stale 200 as
  // "fresh" for the whole TTL — that shadow would keep serving stale data at
  // the edge and bypass the origin's stale-while-revalidate refresh. stale-if-
  // error is kept so transient origin failures still fall back to stale data.
  const sMaxage = remainingSeconds > 0 ? remainingSeconds : 0;
  res.set({
    "Cache-Control": `public, max-age=0, must-revalidate, s-maxage=${sMaxage}, stale-while-revalidate=${staleSeconds}, stale-if-error=${staleSeconds}`,
    ETag: entry.etag,
    "X-Cache-TTL": String(remainingSeconds),
  });
}

function sendEntry(
  req: Request,
  res: Response,
  entry: CacheEntry,
  source: "HIT" | "STALE" | "REFRESHED",
  staleSeconds: number,
): void {
  // Track metrics for each cache response type
  if (source === "HIT") trackMetric("hits");
  else if (source === "STALE") trackMetric("staleServes");

  applyCacheHeaders(res, entry, staleSeconds);
  res.set("X-Cache", source);

  if (!isFresh(entry)) {
    res.set("Warning", '110 - "Response is stale"');
  }

  if (clientHasFreshCopy(req, entry.etag)) {
    res.status(304).end();
    return;
  }

  // Track bytes served for metrics (counted once per serialized body — the
  // same body the client actually receives; a 304 never reaches here).
  const bodyStr = typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body);
  trackMetric("bytesServed", bodyStr.length);

  res.status(entry.statusCode).type("json").send(entry.body);
}

// ─── Redis Operations ─────────────────────────────────────────────

async function readRedis(cacheKey: string): Promise<CacheEntry | null> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return null;

  const raw = await dedupeRedis(`read:${cacheKey}`, () => redis.get(cacheKey));
  if (!raw || typeof raw !== "string") return null;

  let entry: CacheEntry;
  try {
    entry = JSON.parse(raw) as CacheEntry;
  } catch {
    // Corrupt/truncated value (e.g. written by a peer that died mid-write).
    // Remove it so every request stops paying for the failed parse.
    redis.del(cacheKey).catch(() => {});
    return null;
  }
  if (Date.now() > entry.staleUntil) {
    redis.del(cacheKey).catch(() => {});
    return null;
  }

  setMemory(cacheKey, entry);
  return entry;
}

async function writeEntry(cacheKey: string, entry: CacheEntry, ttlSeconds: number, staleSeconds: number): Promise<void> {
  // Drop the write if an invalidation landed after this response was produced —
  // writing it back would resurrect data the admin just deleted (ghost refill).
  if (wasInvalidatedAfter(cacheKey, entry)) return;

  setMemory(cacheKey, entry);

  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;

  const redisTtl = Math.max(1, ttlSeconds + staleSeconds);
  // Fire-and-forget: don't await Redis writes to avoid blocking the response.
  // The memory cache is always populated synchronously, so subsequent requests
  // get cache hits immediately while Redis catches up asynchronously.
  redis.setex(cacheKey, redisTtl, JSON.stringify(entry)).catch((err: unknown) =>
    logger.error({ err, cacheKey }, "Redis write error")
  );

  if (entry.tags.length > 0) {
    const pipeline = redis.pipeline();
    for (const tag of entry.tags) {
      pipeline.sadd(`${TAG_PREFIX}:${tag}`, cacheKey);
      pipeline.expire(`${TAG_PREFIX}:${tag}`, redisTtl);
    }
    pipeline.exec().catch((err: unknown) =>
      logger.error({ err, cacheKey }, "Redis tag write error")
    );
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
  if (cacheControl.includes("no-store")) return true;

  // Requests that carry a session identity must never be served from (or
  // written to) the shared cache: routes like /api/comments and /api/reactions
  // embed per-session state (liked, user_reaction) in their bodies. A cached
  // copy would leak one session's reactions to another. session_id is also
  // deliberately NOT a cacheable query param, so these requests always hit the
  // origin with no-store while session-less (bot/hotlink) requests still get
  // the public cached copy with null user state.
  const sessionId = String((req.query as Record<string, unknown> | undefined)?.session_id ?? "");
  if (sessionId.length > 0) return true;

  return false;
}

// ─── Request Coalescing with Timeout ──────────────────────────────

/**
 * Race an inflight promise against a timeout. If the inflight request
 * takes too long, the waiting request proceeds to the backend instead
 * of hanging indefinitely.
 */
async function awaitInflightWithTimeout(
  inflightPromise: Promise<void>,
  cacheKey: string,
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      inflightPromise,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          trackMetric("inflightTimeouts");
          logger.warn({ cacheKey }, "Inflight request timed out — proceeding to backend");
          resolve();
        }, INFLOW_TIMEOUT_MS);
      }),
    ]);
    return true; // inflight completed
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// ─── Main Cache Middleware ────────────────────────────────────────

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

    // ── Fresh HIT ───────────────────────────────────────────────
    if (existing && isFresh(existing)) {
      sendEntry(req, res, existing, "HIT", staleSeconds);
      return;
    }

    // ── Stale entry available + inflight request ────────────────
    const inflightKey = makeInflightKey(req);
    const existingInflight = inflightReqMap.get(inflightKey);

    if (existingInflight) {
      // Serve stale immediately if available
      // (trackMetric("staleServes") is called inside sendEntry)
      if (existing) {
        sendEntry(req, res, existing, "STALE", staleSeconds);
        return;
      }

      // Wait for inflight with timeout protection
      trackMetric("inflightCoalesced");
      await awaitInflightWithTimeout(existingInflight, cacheKey);

      const refreshed = await readAny(cacheKey);
      if (refreshed) {
        sendEntry(req, res, refreshed, isFresh(refreshed) ? "REFRESHED" : "STALE", staleSeconds);
        return;
      }

      next();
      return;
    }

    // ── Cache MISS — register inflight and pass to handler ──────
    let resolveInflight: (() => void) | null = null;
    const inflightPromise = new Promise<void>((resolve) => {
      resolveInflight = resolve;
    });
    inflightReqMap.set(inflightKey, inflightPromise);
    // Stamp the epoch at request START: if an invalidation lands while this
    // handler is running, the response it produces may be built from data that
    // predates the invalidation — writeEntry uses fillEpoch to refuse it.
    const requestEpoch = epochCounter;

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
          fillEpoch: requestEpoch,
        };

        applyCacheHeaders(res, entryForResponse, staleSeconds);
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
        trackMetric("misses");
      }

      if (resolveInflight) {
        resolveInflight();
        resolveInflight = null;
      }

      return originalJson(body);
    };

    // The finish handler is the authoritative cleanup for the inflight map.
    // It fires for both successful responses and errors (e.g. route throws,
    // timeout middleware sends 504, etc.), so the inflight entry is always
    // cleaned up even if res.json is never called.
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

// ─── Invalidation ─────────────────────────────────────────────────

// Cross-instance invalidation bus. Dedicated response caches live both in this
// process's memory AND in shared Redis; a write handled by instance A (e.g. a
// POST that bumps a recording) clears A's memory cache and deletes the Redis
// keys — but the OTHER still-warm instances keep serving their own stale memory
// copies until they expire. Publishing the invalidation lets every live
// instance drop its local copy immediately, so the shared Redis cache (and its
// epoch-based ghost-refill guard) becomes the single source of truth.
const INVALIDATION_CHANNEL = "chuglii:cache:invalidate:v1";

type InvalidationMessage =
  | { type: "tags"; tags: string[] }
  | { type: "key"; key: string }
  | { type: "pattern"; pattern: string }
  | { type: "purge" };

function publishInvalidation(message: InvalidationMessage): void {
  redisPublish(INVALIDATION_CHANNEL, JSON.stringify(message));
}

let _invalidationSub: PubSubSubscription | null = null;

/**
 * Start listening for invalidation broadcasts from other instances. Subscribers
 * apply the LOCAL half of an invalidation only (memory + the shared Redis
 * delete); the origin instance already did that synchronously, and the CDN
 * purge is only ever performed by the originator. Best-effort: when no Redis or
 * no durable subscription is possible (serverless), it quietly reports false.
 */
export function initInvalidationPubSub(): boolean {
  if (_invalidationSub?.active) return true;
  const sub = redisSubscribe(INVALIDATION_CHANNEL, (raw: string) => {
    let msg: InvalidationMessage;
    try {
      msg = JSON.parse(raw) as InvalidationMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "tags":
        invalidateTagsLocal(msg.tags).catch((err) =>
          logger.error({ err, tags: msg.tags }, "Pub/Sub tag invalidation failed"));
        break;
      case "key":
        invalidateKeyLocal(msg.key).catch((err) =>
          logger.error({ err, key: msg.key }, "Pub/Sub key invalidation failed"));
        break;
      case "pattern":
        invalidatePatternLocal(msg.pattern).catch((err) =>
          logger.error({ err, pattern: msg.pattern }, "Pub/Sub pattern invalidation failed"));
        break;
      case "purge":
        purgeLocalCache().catch((err) =>
          logger.error({ err }, "Pub/Sub cache purge failed"));
        break;
      default:
        break;
    }
  });
  _invalidationSub = sub;
  if (sub.active) {
    logger.info("Cache invalidation pub/sub connected");
  } else {
    logger.warn("Cache invalidation pub/sub unavailable (Redis down or serverless)");
  }
  return sub.active;
}

/**
 * Local-only tag invalidation (memory + shared Redis keys). Exposed separately
 * from `invalidateTags` so the pub/sub handler can apply the shared half of an
 * invalidation a PEER initiated without re-broadcasting (which would loop).
 */
async function invalidateTagsLocal(tags: string[]): Promise<void> {
  const redis = getRedis();
  const keysToDelete = new Set<string>();
  const epoch = stampEpoch();

  for (const tag of tags) {
    tagInvalidationEpoch.set(tag, epoch);
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

export async function invalidateTags(tags: string[]): Promise<void> {
  await invalidateTagsLocal(tags);
  if (tags.length > 0) publishInvalidation({ type: "tags", tags });
}

/** Local-only key invalidation (memory + shared Redis). */
async function invalidateKeyLocal(cacheKey: string): Promise<void> {
  const normalizedKey = cacheKey.startsWith(CACHE_PREFIX)
    ? cacheKey
    : `${CACHE_PREFIX}:${normalizeOriginalUrl(cacheKey)}`;

  rememberKeyInvalidation(normalizedKey);
  deleteMemory(normalizedKey);

  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;
  await redis.del(normalizedKey);
}

export async function invalidateKey(cacheKey: string): Promise<void> {
  await invalidateKeyLocal(cacheKey);
  publishInvalidation({ type: "key", key: cacheKey });
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

/** Local-only pattern invalidation (memory + shared Redis SCAN/DEL). */
async function invalidatePatternLocal(pattern: string): Promise<number> {
  const candidates = patternCandidates(pattern);
  const regexes = candidates.map(wildcardToRegExp);
  const keysToDelete = new Set<string>();
  const epoch = stampEpoch();

  // A pattern invalidation is broad by nature: suppress any fill that raced it.
  if (purgeEpoch < epoch) purgeEpoch = epoch;

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

export async function invalidatePattern(pattern: string): Promise<number> {
  const count = await invalidatePatternLocal(pattern);
  publishInvalidation({ type: "pattern", pattern });
  return count;
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

// ─── Full purge (memory + Redis + CDN) ─────────────────────────────
// The Redis scan covers every keyspace this server owns:
//   api:v2:* / tag:v2:*   — the response cache and its tag indexes
//   api:* / tag:*          — legacy keyspaces written by older deploys
//   media:*                — media-proxy image/transform/DNS/failure blobs
//   views:*                — buffered view counts (pending/base/change-log)
//   hot:*                  — trending ZSETs and their meta hashes
//   sugg:*                 — the search suggestion snapshot index

async function purgeLocalCache(): Promise<{ deletedKeys: number; invalidatedTags: number }> {
  const redis = getRedis();
  const invalidatedTags = new Set(memoryTags.keys());
  let deletedKeys = memoryCache.size;

  // Stamp BEFORE the (async) scan/delete work: any fill that wrote while the
  // purge was in flight must be refused by the writeEntry guard.
  purgeEpoch = stampEpoch();
  tagInvalidationEpoch.clear();
  keyInvalidationEpoch.clear();

  memoryCache.clear();
  memoryTags.clear();

  if (redis && isRedisConnected()) {
    for (const match of [
      `${CACHE_PREFIX}:*`,
      `${TAG_PREFIX}:*`,
      "api:*",
      "tag:*",
      "media:*",
      "views:*",
      "hot:*",
      "sugg:*",
    ]) {
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

  logger.info({ deletedKeys, invalidatedTags: invalidatedTags.size }, "Local cache purge completed");
  return { deletedKeys, invalidatedTags: invalidatedTags.size };
}

export async function purgeAllCache(): Promise<{
  deletedKeys: number;
  invalidatedTags: number;
  cdnPurged: boolean;
}> {
  const local = await purgeLocalCache();

  // Memory + Redis are gone, but the Vercel CDN still holds copies keyed by
  // the s-maxage advertised in cached responses. Best-effort purge it so an
  // admin purge actually takes effect at the edge; fails open (no token or no
  // project id configured → simply reports cdnPurged: false). Only the
  // originating instance pokes the CDN — peers just clear their local caches.
  const cdnPurged = await purgeVercelCdn();

  publishInvalidation({ type: "purge" });

  logger.info(
    { deletedKeys: local.deletedKeys, invalidatedTags: local.invalidatedTags, cdnPurged },
    "Full cache purge completed",
  );
  return { ...local, cdnPurged };
}

/**
 * Best-effort purge of the Vercel CDN edge cache for the whole project.
 * Requires VERCEL_TOKEN (with the project's scope) and VERCEL_PROJECT_ID in
 * the function environment. Returns false (never throws) when not configured
 * or the API call fails.
 */
export async function purgeVercelCdn(): Promise<boolean> {
  const token = process.env.VERCEL_TOKEN ?? "";
  const projectId = process.env.VERCEL_PROJECT_ID ?? "";
  if (!token || !projectId) return false;
  try {
    const res = await fetch(
      `https://api.vercel.com/v1/projects/${encodeURIComponent(projectId)}/cache/purge`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "all" }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    return res.ok;
  } catch (err: unknown) {
    logger.warn({ err }, "Vercel CDN purge failed (best-effort)");
    return false;
  }
}

// ─── Stats & Metrics ──────────────────────────────────────────────

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

/**
 * Get detailed cache performance metrics including hit rates and
 * inflight coalescing stats.
 */
export function getCacheMetrics(): CacheMetrics & {
  hitRate: number;
  staleRate: number;
  totalRequests: number;
  uptimeSeconds: number;
} {
  const totalRequests = metrics.hits + metrics.misses + metrics.staleServes;
  return {
    ...metrics,
    hitRate: totalRequests > 0 ? (metrics.hits / totalRequests) * 100 : 0,
    staleRate: totalRequests > 0 ? (metrics.staleServes / totalRequests) * 100 : 0,
    totalRequests,
    uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
  };
}

/**
 * Reset all cache metrics counters.
 */
export function resetCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
  metrics.staleServes = 0;
  metrics.inflightCoalesced = 0;
  metrics.inflightTimeouts = 0;
  metrics.bytesServed = 0;
  metrics.startTime = Date.now();
}
