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
const DB_VERSION = 3;
const STORE_NAME = "img-cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FRESHNESS_MS = 30 * 60 * 1000; // 30 minutes — skip re-fetch if cached within this window
const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB — up from 150 MB to hold more sprites
const FETCH_TIMEOUT_MS = 10_000; // 10s — down from 15s for faster fallback
const CONCURRENT_FETCHES = 8; // up from 6 — more parallelism for catalog warmer

// ─── Priority types ─────────────────────────────────────────────────────────

export type CachePriority = 1 | 2 | 3; // 1=preview(cold), 2=sprite(warm), 3=thumbnail(hot)

// ─── In-memory LRU cache (reference-counted blob URLs) ──────────────────────
//
// A blob URL is shared by every card displaying the same thumbnail. We must
// NOT revoke it while any card is still using it, otherwise the other cards'
// <img> go blank. Each getCachedBlobUrl() ACQUIRES a reference; the caller
// must call releaseBlobUrl() when done (unmount / src change). Eviction only
// revokes URLs with zero references.

const MEMORY_CACHE_MAX = 750; // up from 500 — holds ~3 pages of thumbnails + sprites
interface MemoryRecord { blobUrl: string; size: number; refs: number; }
const memoryCache = new Map<string, MemoryRecord>(); // url → { blobUrl, size, refs }

// Track actual memory cache byte usage for accurate eviction
let memoryCacheBytes = 0;
const MEMORY_CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB soft cap for memory

function memHasEvictable(): boolean {
  for (const rec of memoryCache.values()) if (rec.refs === 0) return true;
  return false;
}

function memGet(url: string): MemoryRecord | null {
  const record = memoryCache.get(url);
  if (record !== undefined) {
    // Move to end (most recently used)
    memoryCache.delete(url);
    memoryCache.set(url, record);
    return record;
  }
  return null;
}

/** Acquire a reference to a cached blob URL. Returns null if not cached. */
function memAcquire(url: string): string | null {
  const record = memoryCache.get(url);
  if (!record) return null;
  record.refs++;
  return record.blobUrl;
}

/** Release a previously-acquired blob URL; revokes only when fully unused. */
function memRelease(url: string): void {
  const record = memoryCache.get(url);
  if (!record) return;
  record.refs = Math.max(0, record.refs - 1);
  if (record.refs === 0) {
    URL.revokeObjectURL(record.blobUrl);
    memoryCacheBytes = Math.max(0, memoryCacheBytes - record.size);
    memoryCache.delete(url);
  }
}

function memSet(url: string, blobUrl: string, sizeBytes: number, refs = 0) {
  const existing = memoryCache.get(url);
  if (existing && existing.refs > 0) {
    // A URL for this image is currently displayed by a mounted card. Don't
    // clobber it (that would orphan the live object URL). Drop the freshly
    // created one and keep serving the existing entry.
    URL.revokeObjectURL(blobUrl);
    return;
  }
  // Evict by count or byte usage — but NEVER revoke a URL still in use.
  while (
    (memoryCache.size >= MEMORY_CACHE_MAX || memoryCacheBytes >= MEMORY_CACHE_MAX_BYTES) &&
    memHasEvictable()
  ) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    const oldestRecord = memoryCache.get(oldest)!;
    if (oldestRecord.refs > 0) {
      // In use — move to end and keep scanning for an evictable entry.
      memoryCache.delete(oldest);
      memoryCache.set(oldest, oldestRecord);
      continue;
    }
    URL.revokeObjectURL(oldestRecord.blobUrl);
    memoryCache.delete(oldest);
    memoryCacheBytes = Math.max(0, memoryCacheBytes - oldestRecord.size);
  }
  memoryCache.set(url, { blobUrl, size: sizeBytes, refs });
  memoryCacheBytes += sizeBytes;
}

function memDelete(url: string) {
  const record = memoryCache.get(url);
  if (record !== undefined) {
    URL.revokeObjectURL(record.blobUrl);
    memoryCache.delete(url);
    memoryCacheBytes = Math.max(0, memoryCacheBytes - record.size);
  }
}

// ─── In-flight fetch dedup ──────────────────────────────────────────────────

const inflight = new Map<string, Promise<ImageCacheEntry | null>>();

// ─── Per-host concurrency limiter ───────────────────────────────────────────
// Catbox in particular resets HTTP/2 connections (ERR_HTTP2_PROTOCOL_ERROR)
// when hit with too many concurrent requests. We cap how many in-flight
// fetches a single host may have so a page of 24 catbox thumbnails trickles
// through instead of bursting + resetting. Cross-origin hosts that send
// `Access-Control-Allow-Origin` (catbox) are fetched client-side and cached;
// same-origin /api/media (pixhost proxy) is unbounded-ish but still limited.

const SLOW_HOST_RE = /(^|\.)catbox\.moe$|(^|\.)litterbox\.catbox\.moe$/;
const HOST_MAX_CONCURRENT = 8;
const SLOW_HOST_MAX_CONCURRENT = 3;

const hostSemaphores = new Map<string, { running: number; waiters: (() => void)[] }>();

function hostConcurrency(host: string): number {
  return SLOW_HOST_RE.test(host) ? SLOW_HOST_MAX_CONCURRENT : HOST_MAX_CONCURRENT;
}

function acquireHost(host: string): Promise<void> {
  let sem = hostSemaphores.get(host);
  if (!sem) {
    sem = { running: 0, waiters: [] };
    hostSemaphores.set(host, sem);
  }
  return new Promise<void>((resolve) => {
    const tryRun = () => {
      if (sem!.running < hostConcurrency(host)) {
        sem!.running++;
        resolve();
      } else {
        sem!.waiters.push(tryRun);
      }
    };
    tryRun();
  });
}

function releaseHost(host: string): void {
  const sem = hostSemaphores.get(host);
  if (!sem) return;
  sem.running = Math.max(0, sem.running - 1);
  const next = sem.waiters.shift();
  if (next) {
    next();
  } else if (sem.running === 0 && sem.waiters.length === 0) {
    hostSemaphores.delete(host);
  }
}

/**
 * Public wrapper: holds a per-host concurrency slot for the duration of `task`
 * and releases it afterwards. Used by OptimizedImage to throttle direct <img>
 * loads through the same gate the preload paths use (so a full page of
 * thumbnails never hammers an upstream like wsrv.nl with unbounded paralellism).
 * Resolves to a release fn if you need to hold the slot past `task` (e.g. until
 * the image actually finishes loading).
 */
export function acquireHostConcurrency(host: string): Promise<() => void> {
  return acquireHost(host).then(() => () => releaseHost(host));
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return "other"; }
}

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
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Force-clear stale entries (e.g. prior black fallback SVGs) when the
      // schema version changes, so old corrupted/placeholder blobs don't linger.
      if ((event.oldVersion > 0 && event.oldVersion < 3) && db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
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
    // Do NOT touch the in-memory entry here: it may still be displayed by a
    // mounted card (reference counted). LRU eviction handles memory; this only
    // removes the stale IDB copy so it gets re-fetched on the next miss.
    scheduleFlush();
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether a URL is already cached. Checks in-memory first (instant),
 * then falls back to IDB.
 *
 * This is a read-only check — it does NOT create blob URLs or populate
 * the memory cache. Use getCachedBlobUrl() when you need the actual data.
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
  const memRec = memGet(url);
  if (memRec) {
    trackHit("memory", url);
    return memAcquire(url); // acquire a reference for the caller
  }

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
        // Another concurrent reader may have populated memory while this IDB
        // read was in flight — if so, reuse their (still-valid) blob URL and
        // discard the one we just created to avoid a revoked-URL race.
        const existing = memGet(url);
        if (existing) {
          URL.revokeObjectURL(blobUrl);
          return resolve(memAcquire(url));
        }
        // Store acquired (refs=1) — the caller owns this reference.
        memSet(url, blobUrl, entry.size || entry.blob.size || 0, 1);
        resolve(blobUrl);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Release a blob URL previously returned by getCachedBlobUrl(url). Safe to
 * call multiple times and with a null/unknown url. The underlying object URL
 * is only revoked once no caller holds a reference. Pass the ORIGINAL image
 * url (the same string given to getCachedBlobUrl), not the blob: URL.
 */
export function releaseBlobUrl(url: string | null | undefined): void {
  if (!url) return;
  memRelease(url);
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

/**
 * Load an image and return a displayable blob: URL, caching it to IDB on the
 * way. Deduplicated per-URL (concurrent callers share one fetch) and subject
 * to the per-host concurrency limit. Throws if the image cannot be fetched or
 * is not a real image — callers should fall back to a direct <img src>.
 *
 * The returned URL is reference-counted: the caller must call
 * releaseBlobUrl(url) when done (unmount / src change).
 */
export async function loadImageBlobUrl(
  url: string,
  priority: CachePriority = 3,
): Promise<string> {
  const cached = await getCachedBlobUrl(url);
  if (cached) return cached;
  const entry = await cacheImage(url, priority);
  const blob = await getCachedBlobUrl(url);
  if (blob) return blob;
  if (entry) {
    // Cached but evicted from memory between the write and this read — refetch.
    const blob2 = await getCachedBlobUrl(url);
    if (blob2) return blob2;
  }
  releaseBlobUrl(url);
  throw new Error("image load failed: " + url);
}

/**
 * Reject blobs that aren't actually images. Catches corrupt / HTML-error-body
 * responses that arrived with a 200 + image content-type and would otherwise
 * be cached for up to 7 days.
 */
function isValidImageMagic(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const gif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46; // GIF8
  const webp =
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && // RIFF
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50; // WEBP
  const avif =
    head.length >= 12 &&
    head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x00 && head[3] === 0x18 && // size=24
    head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70 && // ftyp
    head[8] === 0x61 && head[9] === 0x76 && head[10] === 0x69 && head[11] === 0x66; // avif
  return jpeg || png || gif || webp || avif;
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

    // Cap concurrent in-flight requests to this host (catbox especially throttles).
    const host = hostOf(url);
    await acquireHost(host);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "image/*,video/*,*/*" },
        credentials: url.startsWith("/") ? "same-origin" : "omit",
        cache: "force-cache",
      });
    } finally {
      clearTimeout(timer);
      releaseHost(host);
    }
    profile.fetchMs += performance.now() - fetchStart;
    profile.fetchCount++;

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > 10 * 1024 * 1024) return null;
    // Never cache the proxy's "Image unavailable" placeholder — storing it as a
    // real thumbnail would mask a recovered image and serve a broken placeholder
    // from IDB for up to 7 days.
    if (contentType.includes("image/svg+xml")) return null;

    const blob = await res.blob();
    if (blob.size === 0 || blob.size > 10 * 1024 * 1024) return null;

    // Validate magic bytes so a corrupt / non-image body is never stored.
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (!isValidImageMagic(head)) return null;

    const entry: ImageCacheEntry = {
      url, blob, type: contentType,
      cachedAt: Date.now(), size: blob.size, priority,
    };

    enqueueWrite(entry);

    // Populate in-memory cache immediately
    const blobUrl = URL.createObjectURL(blob);
    memSet(url, blobUrl, entry.size);

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
    // Presence check only — do NOT create object URLs here (that would require
    // reference counting we can't release from a Set return value).
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
          if (entry && Date.now() - entry.cachedAt <= CACHE_TTL_MS) result.add(url);
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
  for (const record of memoryCache.values()) URL.revokeObjectURL(record.blobUrl);
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

// ─── Cache Budget Management ─────────────────────────────────────

interface CacheBudget {
  /** Maximum total cache size in bytes (IDB + memory) */
  maxTotalBytes: number;
  /** Target cache size after eviction (80% of max) */
  targetBytes: number;
  /** Maximum memory cache entries */
  maxMemoryEntries: number;
  /** Maximum IDB cache size in bytes */
  maxIdbBytes: number;
}

let currentBudget: CacheBudget = {
  maxTotalBytes: MAX_CACHE_BYTES,
  targetBytes: MAX_CACHE_BYTES * 0.8,
  maxMemoryEntries: MEMORY_CACHE_MAX,
  maxIdbBytes: MAX_CACHE_BYTES,
};

/**
 * Get the current cache budget and usage status.
 */
export async function getCacheBudget(): Promise<CacheBudget & {
  currentMemoryBytes: number;
  currentIdbBytes: number;
  totalBytesUsed: number;
  usagePercent: number;
  needsEviction: boolean;
}> {
  const stats = await getCacheStats();
  const totalBytesUsed = stats.memoryBytes + stats.idbBytes;
  return {
    ...currentBudget,
    currentMemoryBytes: stats.memoryBytes,
    currentIdbBytes: stats.idbBytes,
    totalBytesUsed,
    usagePercent: (totalBytesUsed / currentBudget.maxTotalBytes) * 100,
    needsEviction: totalBytesUsed > currentBudget.targetBytes,
  };
}

/**
 * Update cache budget limits. Call this to dynamically adjust
 * cache size based on device capabilities or user preferences.
 */
export function setCacheBudget(budget: Partial<CacheBudget>): void {
  currentBudget = { ...currentBudget, ...budget };
  currentBudget.targetBytes = currentBudget.maxTotalBytes * 0.8;
}

/**
 * Preload images with budget awareness. Checks if adding these images
 * would exceed the budget and evicts old entries if needed.
 *
 * @returns Number of images successfully cached
 */
export async function preloadWithBudget(
  urls: string[],
  priority: CachePriority = 2,
): Promise<number> {
  const budget = await getCacheBudget();
  
  // If we're already over budget, trigger eviction first
  if (budget.needsEviction) {
    await evictIfNeeded();
  }
  
  // Check budget again after eviction
  const afterEviction = await getCacheBudget();
  if (afterEviction.usagePercent > 90) {
    // Still over 90% — skip preloading to prevent OOM
    return 0;
  }
  
  // Estimate total size of URLs to preload (rough: 30KB per thumbnail)
  const estimatedSize = urls.length * 30_000;
  const remainingBudget = afterEviction.maxTotalBytes - afterEviction.totalBytesUsed;
  
  if (estimatedSize > remainingBudget) {
    // Only preload what fits in the remaining budget
    const maxUrls = Math.floor(remainingBudget / 30_000);
    urls = urls.slice(0, maxUrls);
  }
  
  // Batch-cache with concurrency control
  return cacheImages(urls, 4);
}

/**
 * Get a summary of cache health for monitoring dashboards.
 */
export async function getCacheHealth(): Promise<{
  status: "healthy" | "warning" | "critical";
  memoryUtilization: number;
  idbUtilization: number;
  totalUtilization: number;
  hitRate: number;
  recommendations: string[];
}> {
  const budget = await getCacheBudget();
  const profile = getCacheProfile();
  const recommendations: string[] = [];
  
  const memoryUtilization = (budget.currentMemoryBytes / (currentBudget.maxMemoryEntries * 50_000)) * 100;
  const idbUtilization = (budget.currentIdbBytes / currentBudget.maxIdbBytes) * 100;
  const totalUtilization = budget.usagePercent;
  
  let status: "healthy" | "warning" | "critical" = "healthy";
  
  if (totalUtilization > 90) {
    status = "critical";
    recommendations.push("Cache usage critical — consider reducing MAX_CACHE_BYTES");
  } else if (totalUtilization > 75) {
    status = "warning";
    recommendations.push("Cache usage high — eviction will increase");
  }
  
  if (profile.overallHitRate < 50) {
    recommendations.push("Low cache hit rate — check if TTLs are appropriate");
  }
  
  if (profile.memoryHitRate < 30 && profile.idbHitRate > 50) {
    recommendations.push("Memory cache underperforming — consider increasing MEMORY_CACHE_MAX");
  }
  
  return {
    status,
    memoryUtilization,
    idbUtilization,
    totalUtilization,
    hitRate: profile.overallHitRate,
    recommendations,
  };
}
