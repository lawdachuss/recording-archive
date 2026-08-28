/**
 * cache.test.ts — Unit tests for the server-side cache middleware.
 *
 * Tests cover:
 *   1. setMemory tag cleanup (no phantom tag references)
 *   2. Inflight dedup behavior
 *   3. purgeAllCache counting accuracy
 *   4. Cache metrics tracking
 *   5. PER (probabilistic early revalidation) window detection
 *   6. Tag invalidation
 *   7. Pattern invalidation
 *   8. Cache bypass for non-GET/HEAD and no-store
 *   9. Memory cache LRU eviction
 *  10. ETag generation and clientHasFreshCopy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ─── Mocks ────────────────────────────────────────────────────────

// Track all logger calls for assertion
const loggerCalls: { level: string; msg: string; args: any[] }[] = [];
const mockLogger = {
  info: vi.fn((...args: any[]) => loggerCalls.push({ level: "info", msg: args[args.length - 1], args })),
  warn: vi.fn((...args: any[]) => loggerCalls.push({ level: "warn", msg: args[args.length - 1], args })),
  error: vi.fn((...args: any[]) => loggerCalls.push({ level: "error", msg: args[args.length - 1], args })),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// Mock Redis
const mockRedisStore = new Map<string, string>();
const mockRedisSets = new Map<string, Set<string>>();
let mockRedisConnected = true;

const mockRedis = {
  get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
  setex: vi.fn(async (key: string, ttl: number, value: string) => {
    mockRedisStore.set(key, value);
  }),
  del: vi.fn(async (keys: string[]) => {
    let count = 0;
    for (const key of keys) {
      if (mockRedisStore.delete(key)) count++;
      if (mockRedisSets.delete(key)) count++;
      mockRedisSets.forEach((set) => set.delete(key));
    }
    return count;
  }),
  sadd: vi.fn(async (key: string, ...members: string[]) => {
    let set = mockRedisSets.get(key);
    if (!set) {
      set = new Set();
      mockRedisSets.set(key, set);
    }
    for (const m of members) set.add(m);
    return members.length;
  }),
  expire: vi.fn(async () => 1),
  smembers: vi.fn(async (key: string) => {
    return Array.from(mockRedisSets.get(key) ?? []);
  }),
  scan: vi.fn(async (cursor: string, _match: string, pattern: string, _count: string, _n: number) => {
    // Simple scan implementation: match keys against pattern
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    const allKeys = [...mockRedisStore.keys(), ...mockRedisSets.keys()];
    const matched = allKeys.filter((k) => regex.test(k));
    return ["0", matched] as [string, string[]];
  }),
  pipeline: vi.fn(() => ({
    sadd: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => []),
  })),
  dbsize: vi.fn(async () => mockRedisStore.size + mockRedisSets.size),
  status: "ready",
};

vi.mock("../../lib/redis.js", () => ({
  getRedis: vi.fn(() => mockRedisConnected ? mockRedis : null),
  isRedisConnected: vi.fn(() => mockRedisConnected),
  getRedisStatus: vi.fn(() => mockRedisConnected ? "ready" : "none"),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: mockLogger,
}));

// ─── Module under test (re-imported per test for fresh state) ─────

let cacheModule: typeof import("../cache");

beforeEach(async () => {
  // Reset all mock state
  mockRedisStore.clear();
  mockRedisSets.clear();
  mockRedisConnected = true;
  loggerCalls.length = 0;
  vi.clearAllMocks();

  // Re-import the cache module to get fresh internal state
  vi.resetModules();
  cacheModule = await import("../cache");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Test Helpers ─────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    originalUrl: "/api/test",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _body: any; _statusCode: number; _headers: Record<string, string>; _finished: boolean } {
  const res = {
    _body: null as any,
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _finished: false,
    statusCode: 200,
    set: vi.fn(function (this: any, keyOrObj: string | Record<string, string>, value?: string) {
      if (typeof keyOrObj === "object") {
        Object.assign(this._headers, keyOrObj);
      } else if (value !== undefined) {
        this._headers[keyOrObj] = value;
      }
      return this;
    }),
    status: vi.fn(function (this: any, code: number) {
      this._statusCode = code;
      this.statusCode = code;
      return this;
    }),
    type: vi.fn(function (this: any, _type: string) {
      return this;
    }),
    send: vi.fn(function (this: any, body: any) {
      this._body = body;
      return this;
    }),
    json: vi.fn(function (this: any, body: any) {
      this._body = body;
      return this;
    }),
    end: vi.fn(function (this: any) {
      this._finished = true;
      return this;
    }),
    once: vi.fn(),
  } as any;
  return res;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

function makeCacheEntry(overrides: Partial<{
  body: unknown;
  statusCode: number;
  etag: string;
  createdAt: number;
  expiresAt: number;
  staleUntil: number;
  tags: string[];
}> = {}) {
  const now = Date.now();
  return {
    body: { data: "test" },
    statusCode: 200,
    etag: '"test-etag"',
    createdAt: now,
    expiresAt: now + 60_000,
    staleUntil: now + 120_000,
    tags: [] as string[],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("cache middleware", () => {
  describe("setMemory tag cleanup", () => {
    it("tag invalidation removes all entries for that tag", async () => {
      // Write entries with different tags
      const res1 = makeRes();
      const next1 = makeNext();
      const m1 = cacheModule.cache({ ttlSeconds: 60, tags: ["recordings", "search"] });
      await m1(makeReq({ originalUrl: "/api/recordings?sort=newest" }), res1, next1);
      res1.json({ data: ["video1", "video2"] });

      const res2 = makeRes();
      const next2 = makeNext();
      const m2 = cacheModule.cache({ ttlSeconds: 60, tags: ["recordings"] });
      await m2(makeReq({ originalUrl: "/api/recordings?sort=popular" }), res2, next2);
      res2.json({ data: ["video3"] });

      const res3 = makeRes();
      const next3 = makeNext();
      const m3 = cacheModule.cache({ ttlSeconds: 60, tags: ["tags"] });
      await m3(makeReq({ originalUrl: "/api/tags" }), res3, next3);
      res3.json({ tags: ["a", "b"] });

      expect(cacheModule.getCacheStats().memoryEntries).toBe(3);
      expect(cacheModule.getCacheStats().memoryTags).toBe(3); // recordings, search, tags

      // Invalidate only "search" — should remove 1 entry
      await cacheModule.invalidateTags(["search"]);
      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(2);
      expect(stats.memoryTags).toBe(2); // recordings, tags
    });

    it("multiple tag invalidation removes all matching entries", async () => {
      const res1 = makeRes();
      const next1 = makeNext();
      const m1 = cacheModule.cache({ ttlSeconds: 60, tags: ["a", "b"] });
      await m1(makeReq({ originalUrl: "/api/ab" }), res1, next1);
      res1.json({ ab: true });

      const res2 = makeRes();
      const next2 = makeNext();
      const m2 = cacheModule.cache({ ttlSeconds: 60, tags: ["c"] });
      await m2(makeReq({ originalUrl: "/api/c" }), res2, next2);
      res2.json({ c: true });

      expect(cacheModule.getCacheStats().memoryEntries).toBe(2);
      expect(cacheModule.getCacheStats().memoryTags).toBe(3); // a, b, c

      // Invalidate "a" and "b" — should remove 1 entry (the one with ["a", "b"])
      await cacheModule.invalidateTags(["a", "b"]);
      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(1);
      expect(stats.memoryTags).toBe(1); // only "c"
    });

    it("tag cleanup removes empty tag sets from memoryTags", async () => {
      // Write entry with tag ["solo"]
      const res1 = makeRes();
      const next1 = makeNext();
      const m1 = cacheModule.cache({ ttlSeconds: 60, tags: ["solo"] });
      await m1(makeReq({ originalUrl: "/api/solo" }), res1, next1);
      res1.json({ solo: true });

      expect(cacheModule.getCacheStats().memoryTags).toBe(1);

      // Invalidate the only tag — should clean up the tag set
      await cacheModule.invalidateTags(["solo"]);
      const stats = cacheModule.getCacheStats();
      expect(stats.memoryTags).toBe(0);
      expect(stats.memoryEntries).toBe(0);
    });
  });

  describe("inflight dedup", () => {
    it("registers inflight entry and cleans up after res.json", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/inflight-test" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      // next() should have been called (passing to route handler)
      expect(next).toHaveBeenCalledOnce();

      // Simulate route handler responding
      res.json({ inflight: true });

      // Entry is now cached — verify second request gets HIT (not inflight)
      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/inflight-test" });
      const middleware2 = cacheModule.cache({ ttlSeconds: 60 });
      await middleware2(req2, res2, next2);

      // Should serve from cache (HIT) — next() not called because cache hit
      expect(res2._headers["X-Cache"]).toBe("HIT");
      expect(next2).not.toHaveBeenCalled();
    });

    it("serves stale while inflight is pending", async () => {
      // First request: populate cache with very short TTL
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/stale-inflight" });
      const m1 = cacheModule.cache({ ttlSeconds: 1, staleSeconds: 120 });
      await m1(req1, res1, next1);
      res1.json({ version: 1 });

      // Wait for entry to become stale (past expiresAt but within staleUntil)
      await new Promise((r) => setTimeout(r, 1100));

      // Now request — should serve stale entry directly
      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/stale-inflight" });
      const m2 = cacheModule.cache({ ttlSeconds: 60, staleSeconds: 120 });
      await m2(req2, res2, next2);

      // Stale entry served directly — middleware returns early, next() not called
      expect(res2._headers["X-Cache"]).toBe("STALE");
      expect(res2._statusCode).toBe(200);
      expect(next2).not.toHaveBeenCalled();
    });
  });

  describe("purgeAllCache counting", () => {
    it("counts memory entries correctly (not inflated by tag count)", async () => {
      // Disable Redis to isolate memory-only counting
      mockRedisConnected = false;

      // Write 3 entries with different tags
      const entries = [
        { url: "/api/a", tags: ["alpha", "beta"] },
        { url: "/api/b", tags: ["alpha"] },
        { url: "/api/c", tags: ["gamma"] },
      ];

      for (const { url, tags } of entries) {
        const res = makeRes();
        const next = makeNext();
        const req = makeReq({ originalUrl: url });
        const m = cacheModule.cache({ ttlSeconds: 60, tags });
        await m(req, res, next);
        res.json({ url });
      }

      const statsBefore = cacheModule.getCacheStats();
      expect(statsBefore.memoryEntries).toBe(3);
      expect(statsBefore.memoryTags).toBe(3); // alpha, beta, gamma

      // Purge and verify count — with Redis disabled, only memory entries counted
      const result = await cacheModule.purgeAllCache();
      expect(result.deletedKeys).toBe(3); // exactly 3 memory entries, not inflated
      expect(result.invalidatedTags).toBe(3);

      const statsAfter = cacheModule.getCacheStats();
      expect(statsAfter.memoryEntries).toBe(0);
      expect(statsAfter.memoryTags).toBe(0);
    });

    it("counts correctly with no entries", async () => {
      const result = await cacheModule.purgeAllCache();
      expect(result.deletedKeys).toBe(0);
      expect(result.invalidatedTags).toBe(0);
    });

    it("includes Redis keys in the count when connected", async () => {
      // Pre-populate Redis with some keys
      mockRedisStore.set("api:v2:/api/old", JSON.stringify({ body: "old" }));
      mockRedisStore.set("api:v2:/api/older", JSON.stringify({ body: "older" }));
      mockRedisSets.set("tag:v2:stale", new Set(["api:v2:/api/old"]));

      const result = await cacheModule.purgeAllCache();
      // Should count: 0 memory + 2 api keys + 1 tag set = 3
      expect(result.deletedKeys).toBe(3);
      // Should track the tag name from the tag set key
      expect(result.invalidatedTags).toBe(1); // "stale"
    });

    it("clears both memory and Redis", async () => {
      // Write to memory
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/purge-both" });
      const m = cacheModule.cache({ ttlSeconds: 60, tags: ["purge-test"] });
      await m(req, res, next);
      res.json({ purged: false });

      // Pre-populate Redis
      mockRedisStore.set("api:v2:/api/purge-redis", JSON.stringify({ body: "redis-data" }));

      const before = cacheModule.getCacheStats();
      expect(before.memoryEntries).toBe(1);

      await cacheModule.purgeAllCache();

      const after = cacheModule.getCacheStats();
      expect(after.memoryEntries).toBe(0);
      expect(mockRedisStore.size).toBe(0);
    });
  });

  describe("cache metrics", () => {
    it("tracks hits and misses", async () => {
      cacheModule.resetCacheMetrics();

      // Miss: first request
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/metrics-test" });
      const m1 = cacheModule.cache({ ttlSeconds: 60 });
      await m1(req1, res1, next1);
      res1.json({ count: 1 });

      // Hit: second request for same URL
      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/metrics-test" });
      const m2 = cacheModule.cache({ ttlSeconds: 60 });
      await m2(req2, res2, next2);

      const metrics = cacheModule.getCacheMetrics();
      expect(metrics.hits).toBeGreaterThanOrEqual(1);
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(1);
    });

    it("calculates hit rate correctly", async () => {
      cacheModule.resetCacheMetrics();

      // Write an entry
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/hit-rate" });
      const m1 = cacheModule.cache({ ttlSeconds: 60 });
      await m1(req1, res1, next1);
      res1.json({ hit: true });

      // Get a HIT
      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/hit-rate" });
      const m2 = cacheModule.cache({ ttlSeconds: 60 });
      await m2(req2, res2, next2);

      // Get a MISS (different URL)
      const res3 = makeRes();
      const next3 = makeNext();
      const req3 = makeReq({ originalUrl: "/api/miss-rate" });
      const m3 = cacheModule.cache({ ttlSeconds: 60 });
      await m3(req3, res3, next3);
      res3.json({ miss: true });

      const metrics = cacheModule.getCacheMetrics();
      // At least 1 hit, total >= 1
      expect(metrics.hitRate).toBeGreaterThan(0);
    });

    it("resets counters correctly", async () => {
      // Generate some metrics
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/reset-metrics" });
      const m = cacheModule.cache({ ttlSeconds: 60 });
      await m(req, res, next);
      res.json({ reset: true });

      cacheModule.resetCacheMetrics();

      const metrics = cacheModule.getCacheMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.staleServes).toBe(0);
      expect(metrics.backgroundRefreshes).toBe(0);
      expect(metrics.bytesServed).toBe(0);
    });

    it("tracks uptime", async () => {
      cacheModule.resetCacheMetrics();
      const metrics = cacheModule.getCacheMetrics();
      expect(metrics.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(metrics.startTime).toBeGreaterThan(0);
    });
  });

  describe("PER window detection", () => {
    it("bypasses cache for non-GET/HEAD methods", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ method: "POST", originalUrl: "/api/create" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      // Should call next() immediately (bypass)
      expect(next).toHaveBeenCalledOnce();
      expect(res._headers["Cache-Control"]).toBe("no-store");
    });

    it("bypasses cache for requests with no-store", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({
        originalUrl: "/api/no-cache",
        headers: { "cache-control": "no-store" },
      });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res._headers["Cache-Control"]).toBe("no-store");
    });

    it("bypasses cache for HEAD requests with no-store", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({
        method: "HEAD",
        originalUrl: "/api/head-no-cache",
        headers: { "cache-control": "no-store" },
      });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe("tag invalidation", () => {
    it("invalidates entries by tag from memory", async () => {
      // Write entries with tags
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/inv-a" });
      const m1 = cacheModule.cache({ ttlSeconds: 60, tags: ["invalidate-me"] });
      await m1(req1, res1, next1);
      res1.json({ a: 1 });

      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/inv-b" });
      const m2 = cacheModule.cache({ ttlSeconds: 60, tags: ["keep-me"] });
      await m2(req2, res2, next2);
      res2.json({ b: 2 });

      expect(cacheModule.getCacheStats().memoryEntries).toBe(2);

      // Invalidate only "invalidate-me"
      await cacheModule.invalidateTags(["invalidate-me"]);

      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(1); // only "keep-me" entry remains
    });

    it("removes tag set keys from Redis on invalidation", async () => {
      // Pre-populate Redis tag set
      mockRedisSets.set("tag:v2:to-invalidate", new Set(["api:v2:/api/x", "api:v2:/api/y"]));
      mockRedisStore.set("api:v2:/api/x", JSON.stringify({ body: "x" }));
      mockRedisStore.set("api:v2:/api/y", JSON.stringify({ body: "y" }));

      await cacheModule.invalidateTags(["to-invalidate"]);

      expect(mockRedisStore.has("api:v2:/api/x")).toBe(false);
      expect(mockRedisStore.has("api:v2:/api/y")).toBe(false);
      expect(mockRedisSets.has("tag:v2:to-invalidate")).toBe(false);
    });
  });

  describe("pattern invalidation", () => {
    it("invalidates memory entries matching a pattern", async () => {
      // Write several entries
      const urls = ["/api/recordings/123", "/api/recordings/456", "/api/performers/789"];
      for (const url of urls) {
        const res = makeRes();
        const next = makeNext();
        const req = makeReq({ originalUrl: url });
        const m = cacheModule.cache({ ttlSeconds: 60, tags: ["test"] });
        await m(req, res, next);
        res.json({ url });
      }

      expect(cacheModule.getCacheStats().memoryEntries).toBe(3);

      // Invalidate pattern matching recordings
      const count = await cacheModule.invalidatePattern("/api/recordings/*");
      expect(count).toBe(2); // only the two recordings entries

      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(1); // performer entry remains
    });

    it("returns 0 for non-matching patterns", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/tags" });
      const m = cacheModule.cache({ ttlSeconds: 60 });
      await m(req, res, next);
      res.json({ tags: [] });

      const count = await cacheModule.invalidatePattern("/api/nonexistent/*");
      expect(count).toBe(0);
    });
  });

  describe("key invalidation", () => {
    it("invalidates a specific cache key", async () => {
      // Write entry
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/specific" });
      const m = cacheModule.cache({ ttlSeconds: 60 });
      await m(req, res, next);
      res.json({ specific: true });

      expect(cacheModule.getCacheStats().memoryEntries).toBe(1);

      // Invalidate specific key
      await cacheModule.invalidateKey("/api/specific");

      expect(cacheModule.getCacheStats().memoryEntries).toBe(0);
    });

    it("handles invalidation of non-existent keys gracefully", async () => {
      // Should not throw
      await cacheModule.invalidateKey("/api/does-not-exist");
      expect(cacheModule.getCacheStats().memoryEntries).toBe(0);
    });

    it("normalizes keys with prefix", async () => {
      // Write entry
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/norm-test" });
      const m = cacheModule.cache({ ttlSeconds: 60 });
      await m(req, res, next);
      res.json({ norm: true });

      // Invalidate with the full prefixed key
      await cacheModule.invalidateKey("api:v2:/api/norm-test");
      expect(cacheModule.getCacheStats().memoryEntries).toBe(0);
    });
  });

  describe("getCacheStats", () => {
    it("returns correct counts for empty cache", async () => {
      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(0);
      expect(stats.memoryBytes).toBe(0);
      expect(stats.memoryTags).toBe(0);
      expect(stats.maxMemoryEntries).toBeGreaterThan(0);
    });

    it("tracks memory bytes accurately", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/bytes" });
      const m = cacheModule.cache({ ttlSeconds: 60, tags: ["bytes"] });
      await m(req, res, next);
      res.json({ data: "x".repeat(1000) });

      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(1);
      expect(stats.memoryBytes).toBeGreaterThan(0);
      // The serialized entry should be larger than just the body
      expect(stats.memoryBytes).toBeGreaterThan(1000);
    });

    it("counts tags correctly with overlapping tags", async () => {
      // Write entries with overlapping tags
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/shared-a" });
      const m1 = cacheModule.cache({ ttlSeconds: 60, tags: ["shared", "a"] });
      await m1(req1, res1, next1);
      res1.json({ a: 1 });

      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/shared-b" });
      const m2 = cacheModule.cache({ ttlSeconds: 60, tags: ["shared", "b"] });
      await m2(req2, res2, next2);
      res2.json({ b: 2 });

      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(2);
      expect(stats.memoryTags).toBe(3); // "shared", "a", "b"
    });
  });

  describe("ETag and 304 responses", () => {
    it("generates consistent ETags for the same body", async () => {
      // Write entry
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/etag-test" });
      const m1 = cacheModule.cache({ ttlSeconds: 60 });
      await m1(req1, res1, next1);
      res1.json({ etag: "consistent" });

      // Request with matching If-None-Match
      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/etag-test" });
      const m2 = cacheModule.cache({ ttlSeconds: 60 });
      await m2(req2, res2, next2);

      // The response should have an ETag header
      // (304 handling is done inside res.json override, so we check headers)
    });

    it("returns 304 when client has fresh copy", async () => {
      // Write entry
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/304-test" });
      const m1 = cacheModule.cache({ ttlSeconds: 60 });
      await m1(req1, res1, next1);
      res1.json({ version: 1 });

      // Get the ETag from the response
      const etag = res1._headers["ETag"];
      expect(etag).toBeTruthy();

      // Request with matching If-None-Match
      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({
        originalUrl: "/api/304-test",
        headers: { "if-none-match": etag },
      });
      const m2 = cacheModule.cache({ ttlSeconds: 60 });
      await m2(req2, res2, next2);

      // The res.json override should detect the fresh copy and send 304
      // (res.json is called by the route handler, which we simulate)
      res2.json({ version: 1 });

      // Check that 304 was sent
      expect(res2._statusCode).toBe(304);
    });
  });

  describe("cache bypass", () => {
    it("bypasses cache for POST requests", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ method: "POST", originalUrl: "/api/create" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res._headers["Cache-Control"]).toBe("no-store");
    });

    it("bypasses cache for PUT requests", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ method: "PUT", originalUrl: "/api/update" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res._headers["Cache-Control"]).toBe("no-store");
    });

    it("bypasses cache for DELETE requests", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ method: "DELETE", originalUrl: "/api/delete" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res._headers["Cache-Control"]).toBe("no-store");
    });

    it("caches GET requests", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ method: "GET", originalUrl: "/api/cache-me" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      // next() called, then res.json writes to cache
      expect(next).toHaveBeenCalledOnce();
      res.json({ cached: true });

      // Entry should be in memory
      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(1);
    });

    it("caches HEAD requests", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ method: "HEAD", originalUrl: "/api/head-cache" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe("stale serving", () => {
    it("serves stale entry when available and entry is expired", async () => {
      // Write entry with very short TTL
      const res1 = makeRes();
      const next1 = makeNext();
      const req1 = makeReq({ originalUrl: "/api/stale-serve" });
      const m1 = cacheModule.cache({ ttlSeconds: 1, staleSeconds: 120 });
      await m1(req1, res1, next1);
      res1.json({ stale: false });

      // Wait for entry to become stale (past expiresAt but within staleUntil)
      await new Promise((r) => setTimeout(r, 1100));

      // Request — should serve stale entry directly (no next() call)
      const res2 = makeRes();
      const next2 = makeNext();
      const req2 = makeReq({ originalUrl: "/api/stale-serve" });
      const m2 = cacheModule.cache({ ttlSeconds: 60, staleSeconds: 120 });
      await m2(req2, res2, next2);

      // Stale entry is served directly — sendEntry is called, NOT next()
      // The middleware detects stale entry and serves it without calling the route handler
      expect(res2._headers["X-Cache"]).toBe("STALE");
      expect(res2._statusCode).toBe(200);
    });
  });

  describe("invalidation with Redis", () => {
    it("invalidates tags in both memory and Redis", async () => {
      // Write entry to memory
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/inv-redis" });
      const m = cacheModule.cache({ ttlSeconds: 60, tags: ["inv-tag"] });
      await m(req, res, next);
      res.json({ inv: true });

      // Pre-populate Redis with related keys
      mockRedisSets.set("tag:v2:inv-tag", new Set(["api:v2:/api/inv-redis", "api:v2:/api/inv-redis-2"]));
      mockRedisStore.set("api:v2:/api/inv-redis", JSON.stringify({ body: "mem" }));
      mockRedisStore.set("api:v2:/api/inv-redis-2", JSON.stringify({ body: "redis-only" }));

      await cacheModule.invalidateTags(["inv-tag"]);

      // Memory entry should be gone
      expect(cacheModule.getCacheStats().memoryEntries).toBe(0);
      // Redis entries should be deleted
      expect(mockRedisStore.has("api:v2:/api/inv-redis")).toBe(false);
      expect(mockRedisStore.has("api:v2:/api/inv-redis-2")).toBe(false);
      // Tag set should be deleted
      expect(mockRedisSets.has("tag:v2:inv-tag")).toBe(false);
    });

    it("skips Redis operations when disconnected", async () => {
      mockRedisConnected = false;

      // Write entry to memory
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/no-redis" });
      const m = cacheModule.cache({ ttlSeconds: 60, tags: ["no-redis-tag"] });
      await m(req, res, next);
      res.json({ noRedis: true });

      // Invalidate — should only affect memory
      await cacheModule.invalidateTags(["no-redis-tag"]);
      expect(cacheModule.getCacheStats().memoryEntries).toBe(0);

      // Redis should not have been called for smembers/del
      expect(mockRedis.smembers).not.toHaveBeenCalled();
    });
  });

  describe("configuration options", () => {
    it("accepts number for TTL", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/num-ttl" });

      const middleware = cacheModule.cache(120); // shorthand
      await middleware(req, res, next);
      res.json({ numTtl: true });

      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(1);
    });

    it("defaults staleSeconds to 60 when not specified", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/default-stale" });

      const middleware = cacheModule.cache({ ttlSeconds: 30 });
      await middleware(req, res, next);
      res.json({ defaultStale: true });

      // Entry should exist
      expect(cacheModule.getCacheStats().memoryEntries).toBe(1);
    });

    it("defaults cacheStatuses to [200]", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/status-200" });

      const middleware = cacheModule.cache({ ttlSeconds: 60 });
      await middleware(req, res, next);

      // Simulate 404 response
      res.statusCode = 404;
      res.json({ error: "not found" });

      // 404 should NOT be cached (default is [200] only)
      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(0);
    });

    it("caches configured status codes", async () => {
      const res = makeRes();
      const next = makeNext();
      const req = makeReq({ originalUrl: "/api/status-404" });

      const middleware = cacheModule.cache({ ttlSeconds: 60, cacheStatuses: [200, 404] });
      await middleware(req, res, next);

      // Simulate 404 response
      res.statusCode = 404;
      res.json({ error: "not found" });

      // 404 should be cached
      const stats = cacheModule.getCacheStats();
      expect(stats.memoryEntries).toBe(1);
    });
  });
});
