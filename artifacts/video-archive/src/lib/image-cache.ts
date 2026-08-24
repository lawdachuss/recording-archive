/**
 * image-cache.ts — IndexedDB-backed image blob cache
 *
 * Fetches thumbnails, sprite sheets, and preview clips via `fetch()` and
 * stores the raw Response body as a Blob in IndexedDB. On repeat visits
 * the cached blob is served directly — no network round-trip needed.
 *
 * This is the persistence layer behind the catalog warmer: once a URL has
 * been warmed, it survives page reloads, browser restarts, and even
 * service-worker eviction. The browser's HTTP cache is no longer the
 * bottleneck for weak-network users.
 *
 * Design:
 *   - One object store ("img-cache") keyed by URL.
 *   - Each entry: { url, blob, type, cachedAt, size }.
 *   - TTL is 7 days (thumbnails change rarely; sprites even less).
 *   - Max cache size ~150 MB — oldest-first eviction when exceeded.
 *   - All writes go through a serial queue to avoid IDB transaction
 *     collisions under concurrent warm-up.
 */

// ─── Config ─────────────────────────────────────────────────────────────────

const DB_NAME = "vault-img-cache";
const DB_VERSION = 1;
const STORE_NAME = "img-cache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_BYTES = 150 * 1024 * 1024; // 150 MB
const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENT_FETCHES = 6;

// ─── DB handle ──────────────────────────────────────────────────────────────

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
    };
    req.onsuccess = () => {
      const db = req.result;
      _db = db;
      db.onclose = () => { _db = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── Entry shape ────────────────────────────────────────────────────────────

interface ImageCacheEntry {
  url: string;
  blob: Blob;
  type: string; // MIME type (image/jpeg, image/webp, video/mp4, …)
  cachedAt: number;
  size: number;
}

// ─── Serial write queue ─────────────────────────────────────────────────────

let writeQueue: Array<() => Promise<void>> = [];
let writeRunning = false;

async function enqueueWrite(fn: () => Promise<void>) {
  writeQueue.push(fn);
  if (!writeRunning) drainQueue();
}

async function drainQueue() {
  writeRunning = true;
  while (writeQueue.length > 0) {
    const task = writeQueue.shift()!;
    try { await task(); } catch { /* non-fatal */ }
  }
  writeRunning = false;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether a URL is already cached (fast IDB lookup).
 * Returns `true` if the blob exists and hasn't expired.
 */
export async function isCached(url: string): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => {
        const entry = req.result as ImageCacheEntry | undefined;
        if (!entry) return resolve(false);
        if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
          // Expired — delete lazily
          enqueueWrite(() => deleteEntry(url));
          return resolve(false);
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Retrieve a cached blob URL (creates an object URL the caller must revoke).
 * Returns `null` if not cached or expired.
 */
export async function getCachedBlobUrl(url: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(url);
      req.onsuccess = () => {
        const entry = req.result as ImageCacheEntry | undefined;
        if (!entry) return resolve(null);
        if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
          enqueueWrite(() => deleteEntry(url));
          return resolve(null);
        }
        resolve(URL.createObjectURL(entry.blob));
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Retrieve a cached Blob directly (for piping into other APIs).
 * Returns `null` if not cached or expired.
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
          enqueueWrite(() => deleteEntry(url));
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
 * Returns the stored entry on success, `null` on failure.
 * Skips non-OK responses, opaque redirects, and huge responses (>10 MB).
 */
export async function cacheImage(url: string): Promise<ImageCacheEntry | null> {
  // Skip if already cached
  if (await isCached(url)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "image/*,video/*,*/*" },
      // CORS: don't send credentials for proxied URLs
      credentials: url.startsWith("/") ? "same-origin" : "omit",
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);

    // Skip huge responses to prevent IDB bloat
    if (contentLength > 10 * 1024 * 1024) return null;

    const blob = await res.blob();

    // Double-check actual size after download
    if (blob.size > 10 * 1024 * 1024) return null;

    const entry: ImageCacheEntry = {
      url,
      blob,
      type: contentType,
      cachedAt: Date.now(),
      size: blob.size,
    };

    // Enqueue write (non-blocking)
    enqueueWrite(() => writeEntry(entry));

    return entry;
  } catch {
    return null;
  }
}

/**
 * Batch-cache multiple URLs with bounded concurrency.
 * Returns the number of successfully cached entries.
 */
export async function cacheImages(
  urls: string[],
  concurrency = CONCURRENT_FETCHES,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let cached = 0;
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
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
 * Get total cache size in bytes.
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
        const entry = cursor.value as ImageCacheEntry;
        total += entry.size;
        cursor.continue();
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

/**
 * Evict oldest entries until cache is under MAX_CACHE_BYTES.
 */
export async function evictIfNeeded(): Promise<void> {
  try {
    const size = await getCacheSize();
    if (size <= MAX_CACHE_BYTES) return;

    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("cachedAt");
      const req = index.openCursor();
      let currentSize = size;

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || currentSize <= MAX_CACHE_BYTES * 0.8) {
          return; // Done — freed enough
        }
        const entry = cursor.value as ImageCacheEntry;
        currentSize -= entry.size;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* non-fatal */ }
}

/**
 * Clear the entire image cache.
 */
export async function clearImageCache(): Promise<void> {
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

// ─── Internal ───────────────────────────────────────────────────────────────

async function writeEntry(entry: ImageCacheEntry): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* non-fatal */ }
}

async function deleteEntry(url: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* non-fatal */ }
}
