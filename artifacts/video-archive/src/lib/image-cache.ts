/**
 * image-cache.ts — IndexedDB-backed image blob cache with in-memory LRU layer
 *
 * Three-tier cache:
 *   1. In-memory LRU Map — instant repeated lookups (no IDB round-trip)
 *   2. IndexedDB blob store — survives page reloads, browser restarts
 *   3. Network fetch — fallback on cache miss
 *
 * Design:
 *   - One object store ("img-cache") keyed by URL.
 *   - Each entry: { url, blob, type, cachedAt, size, priority }.
 *   - TTL is 7 days (thumbnails change rarely; sprites even less).
 *   - Max cache size ~150 MB — priority-based eviction.
 *   - All writes go through a batched queue to minimize IDB transactions.
 *   - In-flight fetches are deduped — concurrent cacheImage(url) calls
 *     share a single network request.
 *
 * Priority tiers (for eviction ordering):
 *   3 = thumbnail (small ~30KB, hot — evict last)
 *   2 = sprite    (medium ~300KB, warm — evict second)
 *   1 = preview   (large ~1MB, cold — evict first)
 */

// ─── Profiling ─────────────────────────────────────────────────────────────
// Lightweight counters for measuring cache hit rates during development.
// Zero-cost in production builds (tree-shaken via process.env check).

type CacheTier = "memory" | "idb" | "miss" | "fetch" | "dedup" | "fresh_skip";
export interface CacheProfile {
  memoryHits: number;
  idbHits: number;
  misses: number;
  fetches: number;
  deduped: number;
  freshSkips: number;
  totalLookups: number;
  memoryHitRate: number;
  idbHitRate: number;
  overallHitRate: number;
  idbLookupMs: number;
  idbLookupCount: number;
  fetchMs: number;
  fetchCount: number;
  byCategory: Record<string, { hits: number; misses: number; fetches: number }>;
  startTime: number;
}

const profile = {
  memoryHits: 0,
  idbHits: 0,
  misses: 0,
  fetches: 0,
  deduped: 0,
  freshSkips: 0,
  idbLookupMs: 0,
  idbLookupCount: 0,
  fetchMs: 0,
  fetchCount: 0,
  byCategory: {} as Record<string, { hits: number; misses: number; fetches: number }>,
  startTime: Date.now(),
};

function categorizeUrl(url: string): string {
  if (url.includes(".webp") || url.includes("preview")) return "preview";
  if (url.includes("sprite") || url.includes("pixhost")) return "sprite";
  if (url.includes("thumb") || url.includes("thumbnail")) return "thumbnail";
  return "other";
}

function trackHit(tier: CacheTier, url: string) {
  const cat = categorizeUrl(url);
  if (!profile.byCategory[cat]) profile.byCategory[cat] = { hits: 0, misses: 0, fetches: 0 };
  switch (tier) {
    case "memory": profile.memoryHits++; profile.byCategory[cat].hits++; break;
    case "idb": profile.idbHits++; profile.byCategory[cat].hits++; break;
    case "miss": profile.misses++; profile.byCategory[cat].misses++; break;
    case "fetch": profile.fetches++; profile.byCategory[cat].fetches++; break;
    case "dedup": profile.deduped++; break;
    case "fresh_skip": profile.freshSkips++; break;
  }
}

/**
 * Get a snapshot of cache profiling data. Call from browser console:
 *   window.__cacheProfile()
 */
export function getCacheProfile(): CacheProfile {
  const totalLookups = profile.memoryHits + profile.idbHits + profile.misses;
  return {
    ...profile,
    totalLookups,
    memoryHitRate: totalLookups > 0 ? (profile.memoryHits / totalLookups) * 100 : 0,
    idbHitRate: totalLookups > 0 ? (profile.idbHits / totalLookups) * 100 : 0,
    overallHitRate: totalLookups > 0 ? ((profile.memoryHits + profile.idbHits) / totalLookups) * 100 : 0,
    idbLookupMs: profile.idbLookupMs,
    idbLookupCount: profile.idbLookupCount,
    fetchMs: profile.fetchMs,
    fetchCount: profile.fetchCount,
    byCategory: { ...profile.byCategory },
    startTime: profile.startTime,
  };
}

/** Reset profiling counters */
export function resetCacheProfile() {
  profile.memoryHits = 0;
  profile.idbHits = 0;
  profile.misses = 0;
  profile.fetches = 0;
  profile.deduped = 0;
  profile.freshSkips = 0;
  profile.idbLookupMs = 0;
  profile.idbLookupCount = 0;
  profile.fetchMs = 0;
  profile.fetchCount = 0;
  profile.byCategory = {};
  profile.startTime = Date.now();
}

// Expose to browser console for live monitoring
if (typeof window !== "undefined") {
  (window as any).__cacheProfile = getCacheProfile;
  (window as any).__cacheProfileReset = resetCacheProfile;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const DB_NAME = "vault-img-cache";
const DB_VERSION = 2;
const STORE_NAME = "img-cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FRESHNESS_MS = 30 * 60 * 1000; // 30 minutes — skip re-fetch if cached within this window
const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB — up from 150 MB to hold more sprites
const FETCH_TIMEOUT_MS = 10_000; // 10s — down from 15s for faster fallback
const CONCURRENT_FETCHES = 8; // up from 6 — more parallelism for catalog warmer

// ─── Priority types ─────────────────────────────────────────────────────────

export type CachePriority = 1 | 2 | 3; // 1=preview(cold), 2=sprite(warm), 3=thumbnail(hot)

// ─── In-memory LRU cache ────────────────────────────────────────────────────

const MEMORY_CACHE_MAX = 750; // up from 500 — holds ~3 pages of thumbnails + sprites
const memoryCache = new Map<string, string>(); // url → blobUrl

// Track memory cache byte estimate for smarter eviction
let memoryCacheBytes = 0;
const MEMORY_CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB soft cap for memory

function memGet(url: string): string | null {
  const blobUrl = memoryCache.get(url);
  if (blobUrl !== undefined) {
    // Move to end (most recently used)
    memoryCache.delete(url);
    memoryCache.set(url, blobUrl);
    trackHit("memory", url);
    return blobUrl;
  }
  return null;
}

function memSet(url: string, blobUrl: string) {
  // Evict by count or byte estimate — whichever limit is hit first
  while (memoryCache.size >= MEMORY_CACHE_MAX || memoryCacheBytes >= MEMORY_CACHE_MAX_BYTES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) {
      URL.revokeObjectURL(memoryCache.get(oldest)!);
      memoryCache.delete(oldest);
      // Rough estimate: revoke ~30KB per evicted entry (thumbnail average)
      memoryCacheBytes = Math.max(0, memoryCacheBytes - 30_000);
    } else {
      break;
    }
  }
  memoryCache.set(url, blobUrl);
  // Rough estimate: add ~50KB per new entry (sprite average)
  memoryCacheBytes += 50_000;
}

function memDelete(url: string) {
  const blobUrl = memoryCache.get(url);
  if (blobUrl !== undefined) {
    URL.revokeObjectURL(blobUrl);
    memoryCache.delete(url);
    memoryCacheBytes = Math.max(0, memoryCacheBytes - 30_000);
  }
}

// ─── In-flight fetch dedup ──────────────────────────────────────────────────

const inflight = new Map<string, Promise<ImageCacheEntry | null>>();

// ─── IDB handle ─────────────────────────────────────────────────────────────

/** Remove any IDB entries with 0-byte blobs (from cached failed fetches). */
function cleanupEmptyBlobs(db: IDBDatabase) {
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const entry = cursor.value as ImageCacheEntry;
      if (!entry.blob || entry.blob.size === 0) {
        memDelete(entry.url);
        cursor.delete();
      }
      cursor.continue();
    };
  } catch { /* non-fatal */ }
}

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "url" });
        store.createIndex("cachedAt", "cachedAt", { unique: false });
      }
      // Add priority index on upgrade if missing
      const tx = req.transaction!;
      const store = tx.objectStore(STORE_NAME);
      if (store && !store.indexNames.contains("priority")) {
        try { store.createIndex("priority", "priority", { unique: false }); } catch {}
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      _db = db;
      db.onclose = () => { _db = null; };
      // Clean up any corrupted 0-byte entries from previous sessions
      cleanupEmptyBlobs(db);
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── Entry shape ────────────────────────────────────────────────────────────

interface ImageCacheEntry {
  url: string;
  blob: Blob;
  type: string;
  cachedAt: number;
  size: number;
  priority: CachePriority;
}

// ─── Batched write queue ────────────────────────────────────────────────────

interface PendingWrite {
  entry: ImageCacheEntry;
  resolve: (entry: ImageCacheEntry | null) => void;
}

interface PendingDelete {
  url: string;
  resolve: () => void;
}

let writeBatch: PendingWrite[] = [];
let deleteBatch: PendingDelete[] = [];
let flushTimer: number | null = null;
const FLUSH_DELAY_MS = 50;
const FLUSH_BATCH_MAX = 50;

function scheduleFlush() {
  if (writeBatch.length + deleteBatch.length >= FLUSH_BATCH_MAX) {
    flushNow();
  } else if (flushTimer === null) {
    flushTimer = window.setTimeout(flushNow, FLUSH_DELAY_MS);
  }
}

async function flushNow() {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  const writes = writeBatch.splice(0);
  const deletes = deleteBatch.splice(0);
  if (writes.length === 0 && deletes.length === 0) return;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const { entry } of writes) store.put(entry);
    for (const { url } of deletes) store.delete(url);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    for (const { resolve } of writes) resolve(null);
    for (const { resolve } of deletes) resolve();
  } catch {
    for (const { resolve } of writes) resolve(null);
    for (const { resolve } of deletes) resolve();
  }
}

function enqueueWrite(entry: ImageCacheEntry): Promise<ImageCacheEntry | null> {
  return new Promise((resolve) => {
    writeBatch.push({ entry, resolve });
    scheduleFlush();
  });
}

function enqueueDelete(url: string): Promise<void> {
  return new Promise((resolve) => {
    deleteBatch.push({ url, resolve });
    memDelete(url);
    scheduleFlush();
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether a URL is already cached. Checks in-memory first (instant),
 * then falls back to IDB.
 */
export async function isCached(url: string): Promise<boolean> {
  if (memGet(url) !== null) return true;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => {
        const elapsed = performance.now() - t0;
        profile.idbLookupMs += elapsed;
        profile.idbLookupCount++;
        const entry = req.result as ImageCacheEntry | undefined;
        if (!entry) { trackHit("miss", url); return resolve(false); }
        if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
          enqueueDelete(url);
          trackHit("miss", url);
          return resolve(false);
        }
        trackHit("idb", url);
        // Populate memory cache
        const blobUrl = URL.createObjectURL(entry.blob);
        memSet(url, blobUrl);
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Check whether a URL has a fresh IDB entry without creating a blob URL.
 * Useful for callers that want to skip fetching without object URL overhead.
 */
export async function isFresh(url: string, maxAgeMs = FRESHNESS_MS): Promise<boolean> {
  if (memGet(url) !== null) return true;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => {
        const entry = req.result as ImageCacheEntry | undefined;
        resolve(!!entry && Date.now() - entry.cachedAt <= maxAgeMs);
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Retrieve a cached blob URL. Checks in-memory first (instant), then IDB.
 * Returns `null` if not cached or expired.
 *
 * The caller must revoke the returned URL when done to avoid memory leaks.
 */
export async function getCachedBlobUrl(url: string): Promise<string | null> {
  const memHit = memGet(url);
  if (memHit !== null) return memHit;

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => {
        const elapsed = performance.now() - t0;
        profile.idbLookupMs += elapsed;
        profile.idbLookupCount++;
        const entry = req.result as ImageCacheEntry | undefined;
        if (!entry) { trackHit("miss", url); return resolve(null); }
        if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
          enqueueDelete(url);
          trackHit("miss", url);
          return resolve(null);
        }
        trackHit("idb", url);
        const blobUrl = URL.createObjectURL(entry.blob);
        memSet(url, blobUrl);
        resolve(blobUrl);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Retrieve a cached Blob directly (for piping into other APIs).
 */
export async function getCachedBlob(url: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => {
        const entry = req.result as ImageCacheEntry | undefined;
        if (!entry) return resolve(null);
        if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
          enqueueDelete(url);
          return resolve(null);
        }
        resolve(entry.blob);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Fetch a URL and store the response body in IndexedDB.
 * Deduplicates concurrent calls — only one fetch per URL.
 * Skips re-fetching if the IDB entry is fresh (< 1 hour old).
 */
export async function cacheImage(
  url: string,
  priority: CachePriority = 2,
): Promise<ImageCacheEntry | null> {
  const existing = inflight.get(url);
  if (existing) { trackHit("dedup", url); return existing; }

  const promise = _cacheImageInner(url, priority);
  inflight.set(url, promise);
  promise.finally(() => inflight.delete(url));
  return promise;
}

async function _cacheImageInner(
  url: string,
  priority: CachePriority,
): Promise<ImageCacheEntry | null> {
  // Skip if recently cached (stale-while-revalidate window)
  if (await isFresh(url, FRESHNESS_MS)) { trackHit("fresh_skip", url); return null; }

  try {
    trackHit("fetch", url);
    const fetchStart = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "image/*,video/*,*/*" },
      credentials: url.startsWith("/") ? "same-origin" : "omit",
      cache: "force-cache",
    });
    clearTimeout(timer);
    profile.fetchMs += performance.now() - fetchStart;
    profile.fetchCount++;

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > 10 * 1024 * 1024) return null;

    const blob = await res.blob();
    if (blob.size === 0 || blob.size > 10 * 1024 * 1024) return null;

    const entry: ImageCacheEntry = {
      url, blob, type: contentType,
      cachedAt: Date.now(), size: blob.size, priority,
    };

    enqueueWrite(entry);

    // Populate in-memory cache immediately
    const blobUrl = URL.createObjectURL(blob);
    memSet(url, blobUrl);

    return entry;
  } catch {
    return null;
  }
}

/**
 * Batch-check whether multiple URLs are already cached.
 * Checks in-memory first, then IDB for misses.
 * Returns a Set of URLs that ARE cached and fresh.
 */
export async function areCached(urls: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  if (urls.length === 0) return result;

  const idbCandidates: string[] = [];
  for (const url of urls) {
    if (memGet(url) !== null) {
      result.add(url);
    } else {
      idbCandidates.push(url);
    }
  }
  if (idbCandidates.length === 0) return result;

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      let pending = idbCandidates.length;
      for (const url of idbCandidates) {
        const req = store.get(url);
        req.onsuccess = () => {
          const entry = req.result as ImageCacheEntry | undefined;
          if (entry && Date.now() - entry.cachedAt <= CACHE_TTL_MS) {
            result.add(url);
            const blobUrl = URL.createObjectURL(entry.blob);
            memSet(url, blobUrl);
          }
          if (--pending === 0) resolve();
        };
        req.onerror = () => { if (--pending === 0) resolve(); };
      }
    });
  } catch { /* non-fatal */ }
  return result;
}

/**
 * Batch-cache multiple URLs with bounded concurrency.
 */
export async function cacheImages(
  urls: string[],
  concurrency = CONCURRENT_FETCHES,
  onProgress?: (done: number, total: number) => void,
  knownCached?: Set<string>,
): Promise<number> {
  let cached = 0;
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      if (knownCached?.has(urls[i])) {
        onProgress?.(i + 1, urls.length);
        continue;
      }
      const result = await cacheImage(urls[i]);
      if (result) cached++;
      onProgress?.(i + 1, urls.length);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return cached;
}

/**
 * Get total IDB cache size in bytes.
 */
export async function getCacheSize(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).openCursor();
      let total = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(total);
        total += (cursor.value as ImageCacheEntry).size;
        cursor.continue();
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/**
 * Evict entries until cache is under MAX_CACHE_BYTES.
 *
 * Eviction order:
 *   1. Expired entries (any priority) — always first
 *   2. Previews (priority 1) — largest, coldest
 *   3. Sprites (priority 2) — medium
 *   4. Thumbnails (priority 3) — smallest, hottest (evict last)
 *
 * Within each tier, oldest entries are evicted first.
 */
export async function evictIfNeeded(): Promise<void> {
  try {
    const size = await getCacheSize();
    if (size <= MAX_CACHE_BYTES) return;

    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const now = Date.now();
      const target = MAX_CACHE_BYTES * 0.8;
      let currentSize = size;
      const toEvict = new Set<string>();

      // Collect entries to evict: expired first, then by priority+age
      const entries: Array<{ url: string; size: number; priority: number; cachedAt: number; expired: boolean }> = [];
      const scanReq = store.openCursor();
      scanReq.onsuccess = () => {
        const cursor = scanReq.result;
        if (!cursor) {
          // Sort: expired first, then low priority, then oldest
          entries.sort((a, b) => {
            if (a.expired !== b.expired) return a.expired ? -1 : 1;
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.cachedAt - b.cachedAt;
          });
          // Mark entries for eviction until under budget
          for (const e of entries) {
            if (currentSize <= target) break;
            currentSize -= e.size;
            toEvict.add(e.url);
          }
          // Perform deletions
          if (toEvict.size === 0) { resolve(); return; }
          const delReq = store.openCursor();
          delReq.onsuccess = () => {
            const c = delReq.result;
            if (!c) { resolve(); return; }
            const entry = c.value as ImageCacheEntry;
            if (toEvict.has(entry.url)) {
              memDelete(entry.url);
              c.delete();
            }
            c.continue();
          };
          delReq.onerror = () => resolve();
          return;
        }
        const entry = cursor.value as ImageCacheEntry;
        entries.push({
          url: entry.url,
          size: entry.size,
          priority: entry.priority ?? 2,
          cachedAt: entry.cachedAt,
          expired: now - entry.cachedAt > CACHE_TTL_MS,
        });
        cursor.continue();
      };
      scanReq.onerror = () => resolve();
    });
  } catch { /* non-fatal */ }
}

/**
 * Clear the entire image cache (IDB + in-memory).
 */
export async function clearImageCache(): Promise<void> {
  for (const blobUrl of memoryCache.values()) URL.revokeObjectURL(blobUrl);
  memoryCache.clear();
  memoryCacheBytes = 0;

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* non-fatal */ }
}

/**
 * Get cache statistics for debugging/monitoring.
 */
export async function getCacheStats(): Promise<{
  memoryEntries: number;
  memoryBytes: number;
  idbEntries: number;
  idbBytes: number;
  profiling: CacheProfile;
}> {
  let idbEntries = 0;
  let idbBytes = 0;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        idbEntries++;
        idbBytes += (cursor.value as ImageCacheEntry).size;
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  } catch { /* non-fatal */ }
  return {
    memoryEntries: memoryCache.size,
    memoryBytes: memoryCacheBytes,
    idbEntries,
    idbBytes,
    profiling: getCacheProfile(),
  };
}
