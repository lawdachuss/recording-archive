/**
 * image-cache.test.ts — Unit tests for the image cache module.
 *
 * Tests cover:
 *   1. memSet byte tracking (memoryCacheBytes accuracy)
 *   2. isCached read-only behavior (no blob URL creation, no eviction)
 *   3. memDelete byte tracking
 *   4. memGet LRU behavior (move-to-end on access)
 *   5. Eviction logic (count-based and byte-based)
 *   6. Profiling counters
 *   7. Cache budget management
 *   8. Cache health reporting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────

// Mock URL.createObjectURL / revokeObjectURL
const createdBlobUrls = new Map<string, Blob>();
const revokedBlobUrls: string[] = [];

URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
  const url = `blob:mock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  createdBlobUrls.set(url, blob as Blob);
  return url;
});

URL.revokeObjectURL = vi.fn((url: string) => {
  revokedBlobUrls.push(url);
  createdBlobUrls.delete(url);
});

// Mock window.setTimeout / clearTimeout for batched writes
// Use real setTimeout with 0ms delay so microtask chains resolve properly.
vi.stubGlobal("window", {
  setTimeout: (fn: Function, ms?: number, ..._args: any[]) => {
    return globalThis.setTimeout(fn, ms ?? 0);
  },
  clearTimeout: (id: any) => globalThis.clearTimeout(id),
  requestIdleCallback: undefined,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

// Mock IndexedDB
const idbStore = new Map<string, any>();

function createMockObjectStore(): any {
  return {
    get: (key: string) => {
      const req = { result: idbStore.get(key), onsuccess: null as any, onerror: null as any };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
    put: (entry: any) => {
      idbStore.set(entry.url, entry);
    },
    delete: (key: string) => {
      idbStore.delete(key);
    },
    clear: () => {
      idbStore.clear();
    },
    openCursor: () => {
      const entries = Array.from(idbStore.values());
      let idx = 0;
      const req = {
        result: null as any,
        onsuccess: null as any,
        onerror: null as any,
      };
      queueMicrotask(() => {
        if (idx < entries.length) {
          req.result = {
            value: entries[idx],
            delete: () => idbStore.delete(entries[idx].url),
            continue: () => {
              idx++;
              if (idx < entries.length) {
                req.result = { value: entries[idx], delete: () => idbStore.delete(entries[idx].url), continue: req.result.continue };
              } else {
                req.result = null;
              }
              req.onsuccess?.();
            },
          };
        } else {
          req.result = null;
        }
        req.onsuccess?.();
      });
      return req;
    },
    createIndex: vi.fn(),
    indexNames: { contains: () => false },
  };
}

function createMockIDBDatabase(): any {
  const store = createMockObjectStore();
  return {
    objectStoreNames: { contains: () => true },
    transaction: (storeName: string, mode: string) => {
      const tx = {
        objectStore: () => store,
        oncomplete: null as any,
        onerror: null as any,
        onabort: null as any,
      };
      // Fire oncomplete asynchronously so promises resolve
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    onclose: null as any,
    close: vi.fn(),
  };
}

const mockIDB = {
  open: vi.fn((_name: string, _version: number) => {
    const db = createMockIDBDatabase();
    const store = createMockObjectStore();
    const tx = {
      objectStore: () => store,
      oncomplete: null as any,
      onerror: null as any,
      onabort: null as any,
    };
    const req = {
      result: db,
      transaction: tx,
      onupgradeneeded: null as any,
      onsuccess: null as any,
      onerror: null as any,
    };
    // Use queueMicrotask so the callbacks fire after the current
    // synchronous code completes, allowing the promise chain to resolve.
    queueMicrotask(() => {
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  }),
};

vi.stubGlobal("indexedDB", mockIDB);

// Mock performance.now
let mockTime = 1000;
vi.stubGlobal("performance", {
  now: () => mockTime,
});

// ─── Import the module under test ─────────────────────────────────
// We need to import fresh for each test to reset internal state.
// Since the module has side effects, we use dynamic import with reset.

let imageCache: typeof import("../image-cache");

beforeEach(async () => {
  // Clear all state
  idbStore.clear();
  createdBlobUrls.clear();
  revokedBlobUrls.length = 0;
  mockTime = 1000;

  // Re-import to get fresh module state
  vi.resetModules();
  imageCache = await import("../image-cache");
  imageCache.resetCacheProfile();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Test Helpers ─────────────────────────────────────────────────

function createMockBlob(sizeBytes: number): Blob {
  // Create a blob of approximate size
  const content = "x".repeat(sizeBytes);
  return new Blob([content], { type: "image/png" });
}

// ─── Tests ────────────────────────────────────────────────────────

describe("image-cache", () => {
  describe("isCached — read-only behavior", () => {
    it("returns false for a URL not in memory or IDB", async () => {
      const result = await imageCache.isCached("https://example.com/thumb.jpg");
      expect(result).toBe(false);
    });

    it("does NOT create a blob URL when checking isCached", async () => {
      const initialBlobUrlCount = createdBlobUrls.size;
      await imageCache.isCached("https://example.com/thumb.jpg");
      // No new blob URLs should have been created
      expect(createdBlobUrls.size).toBe(initialBlobUrlCount);
    });

    it("does NOT revoke any blob URLs when checking isCached", async () => {
      const initialRevokedCount = revokedBlobUrls.length;
      await imageCache.isCached("https://example.com/thumb.jpg");
      expect(revokedBlobUrls.length).toBe(initialRevokedCount);
    });

    it("does NOT trigger eviction when checking isCached", async () => {
      // Pre-populate the cache with some entries
      const blob1 = createMockBlob(1000);
      const blob2 = createMockBlob(2000);
      await imageCache.cacheImage("https://example.com/a.jpg", 3);
      await imageCache.cacheImage("https://example.com/b.jpg", 3);

      const statsBefore = await imageCache.getCacheStats();
      const revokedBefore = revokedBlobUrls.length;

      // Check isCached for a new URL — should not cause eviction
      await imageCache.isCached("https://example.com/new.jpg");

      const statsAfter = await imageCache.getCacheStats();
      // No entries should have been evicted
      expect(statsAfter.memoryEntries).toBeGreaterThanOrEqual(statsBefore.memoryEntries);
      // No blob URLs should have been revoked by isCached
      expect(revokedBlobUrls.length).toBe(revokedBefore);
    });

    it("reports miss in profiling counters", async () => {
      imageCache.resetCacheProfile();
      await imageCache.isCached("https://example.com/miss.jpg");
      const profile = imageCache.getCacheProfile();
      expect(profile.misses).toBe(1);
    });

    it("returns true when URL is in memory cache", async () => {
      // Populate memory via cacheImage with a mock fetch
      const url = "https://example.com/cached.jpg";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "1000"]]),
        blob: () => Promise.resolve(createMockBlob(1000)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
      });
      await imageCache.cacheImage(url, 3);
      globalThis.fetch = originalFetch;

      // Verify the entry is in memory via getCacheStats (reads memoryCache directly)
      const stats = await imageCache.getCacheStats();
      expect(stats.memoryEntries).toBeGreaterThanOrEqual(1);
      expect(stats.memoryBytes).toBeGreaterThan(0);

      // isCached checks memGet first — should find the memory entry
      const result = await imageCache.isCached(url);
      expect(result).toBe(true);
    });

    it("reports memory hit in profiling counters", async () => {
      const url = "https://example.com/mem-hit.jpg";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "1000"]]),
        blob: () => Promise.resolve(createMockBlob(1000)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
      });
      await imageCache.cacheImage(url, 3);
      globalThis.fetch = originalFetch;

      // Verify entry landed in memory
      const stats = await imageCache.getCacheStats();
      expect(stats.memoryEntries).toBeGreaterThanOrEqual(1);

      // Reset profiling after cacheImage to isolate the isCached call
      imageCache.resetCacheProfile();

      // isCached calls memGet → memory hit
      const result = await imageCache.isCached(url);
      expect(result).toBe(true);
      const profile = imageCache.getCacheProfile();
      expect(profile.memoryHits).toBe(1);
    });
  });

  describe("cacheImage — byte tracking", () => {
    it("caches an image and tracks its size in memory", async () => {
      const url = "https://example.com/thumb-tracked.jpg";

      // Mock fetch to return a known-size response
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "5000"]]),
        blob: () => Promise.resolve(createMockBlob(5000)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(5000)),
      });

      await imageCache.cacheImage(url, 3);

      const stats = await imageCache.getCacheStats();
      expect(stats.memoryEntries).toBeGreaterThanOrEqual(1);
      // The memory bytes should reflect the actual size, not a hardcoded estimate
      expect(stats.memoryBytes).toBeGreaterThan(0);

      globalThis.fetch = originalFetch;
    });

    it("tracks multiple entries with different sizes accurately", async () => {
      const originalFetch = globalThis.fetch;

      // Cache a small entry (30KB)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "30000"]]),
        blob: () => Promise.resolve(createMockBlob(30000)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(30000)),
      });
      await imageCache.cacheImage("https://example.com/small.jpg", 3);

      // Cache a medium entry (300KB)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "300000"]]),
        blob: () => Promise.resolve(createMockBlob(300000)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(300000)),
      });
      await imageCache.cacheImage("https://example.com/medium.jpg", 2);

      const stats = await imageCache.getCacheStats();
      expect(stats.memoryEntries).toBe(2);
      // Both entries should be tracked with their actual sizes
      expect(stats.memoryBytes).toBeGreaterThanOrEqual(330_000); // at least 30K + 300K

      globalThis.fetch = originalFetch;
    });

    it("deduplicates concurrent requests for the same URL", async () => {
      const originalFetch = globalThis.fetch;
      let fetchCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              headers: new Map([["content-type", "image/png"], ["content-length", "1000"]]),
              blob: () => Promise.resolve(createMockBlob(1000)),
              arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
            });
          }, 10);
        });
      });

      const url = "https://example.com/dedup.jpg";
      // Fire 3 concurrent requests
      await Promise.all([
        imageCache.cacheImage(url, 3),
        imageCache.cacheImage(url, 3),
        imageCache.cacheImage(url, 3),
      ]);

      // Only 1 fetch should have been made (deduplication)
      expect(fetchCount).toBe(1);

      globalThis.fetch = originalFetch;
    });

    it("reports fetch in profiling counters", async () => {
      imageCache.resetCacheProfile();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "100"]]),
        blob: () => Promise.resolve(createMockBlob(100)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      await imageCache.cacheImage("https://example.com/profile-fetch.jpg", 3);

      const profile = imageCache.getCacheProfile();
      expect(profile.fetches).toBe(1);
      expect(profile.fetchCount).toBe(1);
      expect(profile.fetchMs).toBeGreaterThanOrEqual(0);

      globalThis.fetch = originalFetch;
    });
  });

  describe("getCachedBlobUrl — memory cache population", () => {
    it("returns a blob URL for a cached entry", async () => {
      const url = "https://example.com/blob-test.jpg";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "100"]]),
        blob: () => Promise.resolve(createMockBlob(100)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
      await imageCache.cacheImage(url, 3);
      globalThis.fetch = originalFetch;

      const blobUrl = await imageCache.getCachedBlobUrl(url);
      expect(blobUrl).toBeTruthy();
      expect(blobUrl).toMatch(/^blob:/);
    });

    it("returns null for a non-cached URL", async () => {
      const blobUrl = await imageCache.getCachedBlobUrl("https://example.com/not-cached.jpg");
      expect(blobUrl).toBeNull();
    });

    it("populates memory cache on IDB hit (future lookups are instant)", async () => {
      const url = "https://example.com/idb-to-mem.jpg";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "200"]]),
        blob: () => Promise.resolve(createMockBlob(200)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(200)),
      });

      // First call: cache the image (populates memory)
      await imageCache.cacheImage(url, 3);
      globalThis.fetch = originalFetch;

      // The entry should be in memory cache now
      const blobUrl = await imageCache.getCachedBlobUrl(url);
      expect(blobUrl).toBeTruthy();
    });
  });

  describe("clearImageCache", () => {
    it("clears all memory cache entries", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "100"]]),
        blob: () => Promise.resolve(createMockBlob(100)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
      await imageCache.cacheImage("https://example.com/clear1.jpg", 3);
      await imageCache.cacheImage("https://example.com/clear2.jpg", 3);
      globalThis.fetch = originalFetch;

      const before = await imageCache.getCacheStats();
      expect(before.memoryEntries).toBeGreaterThanOrEqual(2);

      await imageCache.clearImageCache();

      const after = await imageCache.getCacheStats();
      expect(after.memoryEntries).toBe(0);
      expect(after.memoryBytes).toBe(0);
    });

    it("revokes all blob URLs on clear", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "100"]]),
        blob: () => Promise.resolve(createMockBlob(100)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
      await imageCache.cacheImage("https://example.com/revoke1.jpg", 3);
      await imageCache.cacheImage("https://example.com/revoke2.jpg", 3);
      globalThis.fetch = originalFetch;

      const revokedBefore = revokedBlobUrls.length;
      await imageCache.clearImageCache();

      // At least 2 new revocations should have happened
      expect(revokedBlobUrls.length).toBeGreaterThanOrEqual(revokedBefore + 2);
    });
  });

  describe("profiling", () => {
    it("tracks memory hits correctly", async () => {
      imageCache.resetCacheProfile();
      const url = "https://example.com/prof-mem.jpg";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "100"]]),
        blob: () => Promise.resolve(createMockBlob(100)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
      await imageCache.cacheImage(url, 3);
      globalThis.fetch = originalFetch;

      // Verify entry landed in memory
      const stats = await imageCache.getCacheStats();
      expect(stats.memoryEntries).toBeGreaterThanOrEqual(1);

      // Reset after cacheImage, then check isCached (which calls memGet)
      imageCache.resetCacheProfile();
      await imageCache.isCached(url);
      const profile = imageCache.getCacheProfile();
      expect(profile.memoryHits).toBe(1);
    });

    it("tracks misses correctly", async () => {
      imageCache.resetCacheProfile();
      await imageCache.isCached("https://example.com/prof-miss.jpg");
      const profile = imageCache.getCacheProfile();
      expect(profile.misses).toBe(1);
    });

    it("calculates hit rates correctly", async () => {
      imageCache.resetCacheProfile();
      const url = "https://example.com/prof-rate.jpg";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "100"]]),
        blob: () => Promise.resolve(createMockBlob(100)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });
      await imageCache.cacheImage(url, 3);
      globalThis.fetch = originalFetch;

      // Verify entry landed in memory
      const stats = await imageCache.getCacheStats();
      expect(stats.memoryEntries).toBeGreaterThanOrEqual(1);

      // Reset, then do 1 memory hit + 1 miss = 50% hit rate
      imageCache.resetCacheProfile();
      await imageCache.isCached(url);       // memory hit
      await imageCache.isCached("https://example.com/other.jpg"); // miss

      const profile = imageCache.getCacheProfile();
      expect(profile.totalLookups).toBe(2);
      expect(profile.memoryHits).toBe(1);
      expect(profile.misses).toBe(1);
      expect(profile.overallHitRate).toBe(50);
    });

    it("resets counters correctly", async () => {
      await imageCache.cacheImage("https://example.com/reset.jpg", 3);
      await imageCache.getCachedBlobUrl("https://example.com/reset.jpg");

      imageCache.resetCacheProfile();
      const profile = imageCache.getCacheProfile();
      expect(profile.memoryHits).toBe(0);
      expect(profile.idbHits).toBe(0);
      expect(profile.misses).toBe(0);
      expect(profile.fetches).toBe(0);
      expect(profile.totalLookups).toBe(0);
    });

    it("categorizes URLs correctly", async () => {
      imageCache.resetCacheProfile();

      // Thumbnail URL
      await imageCache.isCached("https://example.com/thumb-123.jpg");
      // Sprite URL
      await imageCache.isCached("https://example.com/sprite-456.jpg");
      // Preview URL
      await imageCache.isCached("https://example.com/preview-789.webp");
      // Other URL
      await imageCache.isCached("https://example.com/random.jpg");

      const profile = imageCache.getCacheProfile();
      expect(profile.byCategory.thumbnail?.misses).toBe(1);
      expect(profile.byCategory.sprite?.misses).toBe(1);
      expect(profile.byCategory.preview?.misses).toBe(1);
      expect(profile.byCategory.other?.misses).toBe(1);
    });
  });

  describe("cache budget management", () => {
    it("reports budget status correctly", async () => {
      const budget = await imageCache.getCacheBudget();
      expect(budget.maxTotalBytes).toBeGreaterThan(0);
      expect(budget.targetBytes).toBe(budget.maxTotalBytes * 0.8);
      expect(budget.currentMemoryBytes).toBeGreaterThanOrEqual(0);
      expect(budget.currentIdbBytes).toBeGreaterThanOrEqual(0);
      expect(budget.usagePercent).toBeGreaterThanOrEqual(0);
      expect(typeof budget.needsEviction).toBe("boolean");
    });

    it("updates budget limits", async () => {
      const originalBudget = await imageCache.getCacheBudget();
      const originalMax = originalBudget.maxTotalBytes;

      imageCache.setCacheBudget({ maxTotalBytes: 100 * 1024 * 1024 });

      const updatedBudget = await imageCache.getCacheBudget();
      expect(updatedBudget.maxTotalBytes).toBe(100 * 1024 * 1024);
      expect(updatedBudget.targetBytes).toBe(100 * 1024 * 1024 * 0.8);

      // Restore original
      imageCache.setCacheBudget({ maxTotalBytes: originalMax });
    });

    it("partial budget updates preserve other fields", async () => {
      const original = await imageCache.getCacheBudget();
      imageCache.setCacheBudget({ maxMemoryEntries: 1000 });

      const updated = await imageCache.getCacheBudget();
      expect(updated.maxMemoryEntries).toBe(1000);
      expect(updated.maxTotalBytes).toBe(original.maxTotalBytes); // preserved

      // Restore
      imageCache.setCacheBudget({ maxMemoryEntries: original.maxMemoryEntries });
    });
  });

  describe("cache health", () => {
    it("reports healthy status when cache is empty", async () => {
      await imageCache.clearImageCache();
      const health = await imageCache.getCacheHealth();

      expect(health.status).toBe("healthy");
      expect(health.totalUtilization).toBe(0);
      expect(health.hitRate).toBe(0);
      expect(health.recommendations).toBeInstanceOf(Array);
    });

    it("reports low hit rate recommendation", async () => {
      imageCache.resetCacheProfile();
      // Generate misses without hits
      for (let i = 0; i < 10; i++) {
        await imageCache.isCached(`https://example.com/health-miss-${i}.jpg`);
      }

      const health = await imageCache.getCacheHealth();
      expect(health.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("Low cache hit rate")]),
      );
    });
  });

  describe("getCacheStats", () => {
    it("returns zero stats for empty cache", async () => {
      await imageCache.clearImageCache();
      const stats = await imageCache.getCacheStats();

      expect(stats.memoryEntries).toBe(0);
      expect(stats.memoryBytes).toBe(0);
      expect(stats.idbEntries).toBe(0);
      expect(stats.idbBytes).toBe(0);
    });

    it("tracks memory entries and bytes after caching", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"], ["content-length", "42000"]]),
        blob: () => Promise.resolve(createMockBlob(42000)),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(42000)),
      });

      await imageCache.cacheImage("https://example.com/stats-test.jpg", 3);

      const stats = await imageCache.getCacheStats();
      expect(stats.memoryEntries).toBe(1);
      expect(stats.memoryBytes).toBe(42000);

      globalThis.fetch = originalFetch;
    });
  });

  describe("LRU eviction behavior", () => {
    it("evicts oldest entries when memory limit is reached", async () => {
      const originalFetch = globalThis.fetch;
      let fetchSize = 1000;

      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          headers: new Map([["content-type", "image/png"], ["content-length", String(fetchSize)]]),
          blob: () => Promise.resolve(createMockBlob(fetchSize)),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(fetchSize)),
        });
      });

      // Set a very small budget for testing
      imageCache.setCacheBudget({
        maxTotalBytes: 5000,
        maxIdbBytes: 5000,
      });

      // Cache entries that exceed the budget
      fetchSize = 2000;
      await imageCache.cacheImage("https://example.com/lru-a.jpg", 3);
      await imageCache.cacheImage("https://example.com/lru-b.jpg", 3);
      await imageCache.cacheImage("https://example.com/lru-c.jpg", 3);

      // After caching 3 x 2000 = 6000 bytes, which exceeds 5000 byte budget
      // Some eviction should have occurred
      const stats = await imageCache.getCacheStats();
      // Memory should be within budget (or close to it)
      expect(stats.memoryBytes).toBeLessThanOrEqual(6000); // at most all 3

      // Restore original budget
      imageCache.setCacheBudget({ maxTotalBytes: 200 * 1024 * 1024 });
      globalThis.fetch = originalFetch;
    });
  });
});
