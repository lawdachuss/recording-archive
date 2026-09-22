/**
 * cache.ts — multi-tier resilient client cache (Memory LRU -> localStorage -> IndexedDB)
 *
 * Tier 0 (sub-millisecond): In-memory LRU Map (instant synchronous hits, 0 I/O)
 * Tier 1: localStorage (< 100KB, fast serialized JSON)
 * Tier 2: IndexedDB (large records, background writes, multi-MB capacity)
 *
 * Designed to handle intense traffic gracefully:
 *  - High concurrency deduplication (coalescing simultaneous gets to single IDB read)
 *  - Idle-prioritized background sweeps (never blocks animations or user clicks)
 *  - Fast in-memory hit path eliminates IDB transaction overhead entirely
 */

const CLEANUP_INTERVAL_MS = 60_000;
const LS_SIZE_WARN = 100 * 1024; // 100KB limit for localStorage

// ─── Tier 0: In-Memory High-Speed LRU Cache ─────────────────────────

interface CacheEntry<T> {
  key: string;
  data: T;
  expiresAt: number;
}

const MEMORY_CACHE_MAX = 500;
const memoryCache = new Map<string, CacheEntry<unknown>>();

function memGet<T>(key: string): T | undefined {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return undefined;
  }
  // Refresh LRU order
  memoryCache.delete(key);
  memoryCache.set(key, entry as CacheEntry<unknown>);
  return entry.data;
}

function memSet<T>(key: string, data: T, ttlMs: number): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey !== undefined) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, { key, data, expiresAt: Date.now() + ttlMs } as CacheEntry<unknown>);
}

function memDelete(key: string): void {
  memoryCache.delete(key);
}

// In-flight read deduplication: concurrent reads for the same key await one promise
const inFlightGets = new Map<string, Promise<unknown>>();

// ─── IndexedDB setup ──────────────────────────────────────────────

const DB_NAME = "vault-cache";
const DB_VERSION = 2;
const STORE_NAME = "cache-store";

let _idb: IDBDatabase | null = null;
let _idbOpenPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_idb) return Promise.resolve(_idb);
  if (_idbOpenPromise) return _idbOpenPromise;

  _idbOpenPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB not supported"));
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      } else {
        const tx = req.transaction;
        if (tx) {
          const store = tx.objectStore(STORE_NAME);
          if (!store.indexNames.contains("expiresAt")) {
            try { store.createIndex("expiresAt", "expiresAt", { unique: false }); } catch {}
          }
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      _idb = db;
      _idbOpenPromise = null;
      db.onclose = () => {
        _idb = null;
        _idbOpenPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      _idbOpenPromise = null;
      reject(req.error);
    };
  });

  return _idbOpenPromise;
}

// ─── localStorage tier ────────────────────────────────────────────

function lsGet<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(`vc:${key}`);
    if (!raw) return undefined;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(`vc:${key}`);
      return undefined;
    }
    return entry.data;
  } catch {
    return undefined;
  }
}

function lsSet<T>(key: string, data: T, ttlMs: number): boolean {
  const entry: CacheEntry<T> = { key, data, expiresAt: Date.now() + ttlMs };
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > LS_SIZE_WARN) return false;
    localStorage.setItem(`vc:${key}`, raw);
    return true;
  } catch {
    return false;
  }
}

function lsDelete(key: string): void {
  try {
    localStorage.removeItem(`vc:${key}`);
  } catch {}
}

// ─── IndexedDB tier ───────────────────────────────────────────────

async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry<T> | undefined;
        if (!entry) return resolve(undefined);
        if (Date.now() > entry.expiresAt) {
          idbDelete(key).catch(() => {});
          return resolve(undefined);
        }
        resolve(entry.data);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  try {
    const db = await openDB();
    const entry: CacheEntry<T> = { key, data, expiresAt: Date.now() + ttlMs };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function idbClear(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

// ─── Non-Blocking Periodic Cleanup ────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function performIdleCleanup(): void {
  // localStorage sweep
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("vc:")) {
        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const entry = JSON.parse(raw);
            if (Date.now() > entry.expiresAt) toDelete.push(k);
          }
        } catch {
          toDelete.push(k);
        }
      }
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch {}

  // IndexedDB sweep using index for fast range query
  try {
    openDB().then((db) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const now = Date.now();

      if (store.indexNames.contains("expiresAt")) {
        const index = store.index("expiresAt");
        const range = IDBKeyRange.upperBound(now);
        const req = index.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      } else {
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const entry = cursor.value as CacheEntry<unknown>;
          if (now > entry.expiresAt) cursor.delete();
          cursor.continue();
        };
      }
    }).catch(() => {});
  } catch {}
}

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(performIdleCleanup, { timeout: 2000 });
    } else {
      setTimeout(performIdleCleanup, 0);
    }
  }, CLEANUP_INTERVAL_MS);
}

export function initCache(): void {
  startCleanup();
}

// ─── Public API ───────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  // Tier 0: In-memory LRU (ultra-fast, 0 I/O)
  const mem = memGet<T>(key);
  if (mem !== undefined) return mem;

  // Tier 1: localStorage (fast synchronous)
  const ls = lsGet<T>(key);
  if (ls !== undefined) {
    memSet(key, ls, 5 * 60_000); // warm memory tier
    return ls;
  }

  // Tier 2: IndexedDB with request coalescing to prevent duplicate concurrent queries
  if (inFlightGets.has(key)) {
    return inFlightGets.get(key) as Promise<T | undefined>;
  }

  const fetchPromise = idbGet<T>(key).then((val) => {
    if (val !== undefined) {
      memSet(key, val, 5 * 60_000); // warm memory tier
    }
    return val;
  }).finally(() => {
    inFlightGets.delete(key);
  });

  inFlightGets.set(key, fetchPromise);
  return fetchPromise;
}

export function cacheGetSync<T>(key: string): T | undefined {
  const mem = memGet<T>(key);
  if (mem !== undefined) return mem;
  const ls = lsGet<T>(key);
  if (ls !== undefined) {
    memSet(key, ls, 5 * 60_000);
    return ls;
  }
  return undefined;
}

/** Async read from local tiers only. */
export async function cacheGetLocal<T>(key: string): Promise<T | undefined> {
  return cacheGet<T>(key);
}

export async function cacheSetLocal<T>(key: string, data: T, ttlMs: number): Promise<void> {
  memSet(key, data, ttlMs);
  if (!lsSet(key, data, ttlMs)) {
    lsDelete(key);
    await idbSet(key, data, ttlMs);
  }
}

export async function cacheSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  memSet(key, data, ttlMs);
  if (!lsSet(key, data, ttlMs)) {
    lsDelete(key);
    await idbSet(key, data, ttlMs);
  }
}

export async function cacheDelete(key: string): Promise<void> {
  memDelete(key);
  lsDelete(key);
  await idbDelete(key);
}

export async function cacheClear(): Promise<void> {
  memoryCache.clear();
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("vc:")) toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch {}
  await idbClear();
}

export const CACHE_TTL = {
  SHORT: 30_000,       // 30s — search suggestions, live counts
  MEDIUM: 5 * 60_000,  // 5m — performer lists, tag lists
  LONG: 30 * 60_000,   // 30m — stats, recording detail (infrequent changes)
  DAY: 24 * 60 * 60_000, // 24h — static reference data
} as const;