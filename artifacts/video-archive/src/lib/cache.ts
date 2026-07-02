/**
 * cache.ts — two-tier storage cache
 *
 * Tier 1: localStorage — small JSON payloads (< 100KB serialized).
 * Tier 2: IndexedDB — large blobs, images, big response bodies.
 *
 * All entries have a TTL. Expired entries are lazily evicted on read.
 * A periodic cleanup sweep runs once per minute.
 */

const CLEANUP_INTERVAL_MS = 60_000;
const LS_SIZE_WARN = 100 * 1024; // warn if serialized payload exceeds 100KB

// ─── IndexedDB setup ──────────────────────────────────────────────

const DB_NAME = "vault-cache";
const DB_VERSION = 1;
const STORE_NAME = "cache-store";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Entry shape ──────────────────────────────────────────────────

interface CacheEntry<T> {
  key: string;
  data: T;
  expiresAt: number;
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
  const raw = JSON.stringify(entry);
  if (raw.length > LS_SIZE_WARN) return false; // too big for LS
  try {
    localStorage.setItem(`vc:${key}`, raw);
    return true;
  } catch {
    return false;
  }
}

function lsDelete(key: string) {
  try { localStorage.removeItem(`vc:${key}`); } catch {}
}

// ─── IndexedDB tier ───────────────────────────────────────────────

let _idbCache: Map<string, CacheEntry<unknown>> | null = null;

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
          idbDelete(key);
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

// ─── Periodic cleanup ─────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(async () => {
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
          } catch { toDelete.push(k); }
        }
      }
      toDelete.forEach(k => localStorage.removeItem(k));
    } catch {}

    // IndexedDB sweep
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const entry = cursor.value as CacheEntry<unknown>;
        if (Date.now() > entry.expiresAt) cursor.delete();
        cursor.continue();
      };
    } catch {}
  }, CLEANUP_INTERVAL_MS);
}

export function initCache() {
  startCleanup();
}

// ─── Public API ───────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  // Try localStorage first (fastest)
  const ls = lsGet<T>(key);
  if (ls !== undefined) return ls;
  // Fallback to IndexedDB
  return idbGet<T>(key);
}

export function cacheGetSync<T>(key: string): T | undefined {
  return lsGet<T>(key);
}

export async function cacheSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  if (!lsSet(key, data, ttlMs)) {
    // Too large for LS — store in IndexedDB
    await idbSet(key, data, ttlMs);
  }
}

export async function cacheDelete(key: string): Promise<void> {
  lsDelete(key);
  await idbDelete(key);
}

export async function cacheClear(): Promise<void> {
  // Clear localStorage prefix
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("vc:")) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  } catch {}
  await idbClear();
}

/**
 * Composite key helper for API responses.
 */
export function apiCacheKey(method: string, path: string): string {
  return `api:${method}:${path}`;
}

export const CACHE_TTL = {
  SHORT: 30_000,       // 30s — search suggestions, live counts
  MEDIUM: 5 * 60_000,  // 5m — performer lists, tag lists
  LONG: 30 * 60_000,   // 30m — stats, recording detail (infrequent changes)
  DAY: 24 * 60 * 60_000, // 24h — static reference data
} as const;
