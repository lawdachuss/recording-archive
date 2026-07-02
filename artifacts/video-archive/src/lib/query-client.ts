/**
 * query-client.ts — enhanced QueryClient with persistence, network-aware
 * stale times, and a prefetch manager.
 *
 * Persists the React Query cache to localStorage so in-flight and cached
 * data survives full page reloads (not just soft navigations).
 *
 * Network-aware stale times:
 *   - Slow connection (effectiveType ~"2g" / "slow-2g") → staleTime 30m
 *   - Fast connection → per-query configured value
 */

import { QueryClient, onlineManager } from "@tanstack/react-query";
import { cacheGetSync, cacheSet, apiCacheKey, CACHE_TTL } from "./cache";

const PERSIST_KEY = "vault-rq-cache";
const PERSIST_TTL = 30 * 60_000; // persist cache snapshot for 30 min

// ─── Network detection ────────────────────────────────────────────

type ConnectionSpeed = "slow" | "fast";

function getConnectionSpeed(): ConnectionSpeed {
  try {
    const conn = (navigator as any).connection;
    if (conn) {
      const et = conn.effectiveType as string;
      if (et === "slow-2g" || et === "2g") return "slow";
    }
  } catch {}
  return "fast";
}

function getStaleTime(base: number): number {
  return getConnectionSpeed() === "slow" ? 30 * 60_000 : base;
}

// ─── Persistence ──────────────────────────────────────────────────

interface PersistedCache {
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Save the current query cache to localStorage with a TTL.
 * Called on `routeChange` (before the page unloads).
 */
export function persistQueryCache(queryClient: QueryClient) {
  const cache = queryClient.getQueryCache();
  const queries = cache.getAll();
  const data: Record<string, unknown> = {};

  for (const q of queries) {
    const state = q.state;
    if (state && state.data !== undefined && state.status === "success") {
      data[JSON.stringify(q.queryKey)] = {
        data: state.data,
        dataUpdatedAt: state.dataUpdatedAt,
      };
    }
  }

  if (Object.keys(data).length > 0) {
    const payload: PersistedCache = {
      timestamp: Date.now(),
      data,
    };
    // Use the TTL cache (switches to IndexedDB if payload > ~100KB)
    cacheSet(PERSIST_KEY, payload, PERSIST_TTL);
  }
}

/**
 * Restore a previously persisted query cache.
 */
export function restoreQueryCache(queryClient: QueryClient) {
  // Try sync first (fastest path — works for small caches)
  let persisted = cacheGetSync<PersistedCache>(PERSIST_KEY);
  if (!persisted) {
    // Cache miss from sync — schedule an async restore later
    setTimeout(async () => {
      try {
        const { cacheGet } = await import("./cache");
        const p = await cacheGet<PersistedCache>(PERSIST_KEY);
        if (p) applyCache(queryClient, p);
      } catch {}
    }, 0);
    return;
  }

  // Check TTL expiry
  if (Date.now() - persisted.timestamp > PERSIST_TTL) {
    try { localStorage.removeItem(`vc:${PERSIST_KEY}`); } catch {}
    return;
  }

  applyCache(queryClient, persisted);
}

function applyCache(queryClient: QueryClient, persisted: PersistedCache) {
  const cache = queryClient.getQueryCache();
  for (const [keyStr, entry] of Object.entries(persisted.data)) {
    try {
      const queryKey = JSON.parse(keyStr) as unknown[];
      const existing = cache.find({ queryKey, exact: true });
      // Don't overwrite fresher data
      if (existing && existing.state.dataUpdatedAt > (entry as any).dataUpdatedAt) continue;

      queryClient.setQueryData(queryKey, (entry as any).data, {
        updatedAt: (entry as any).dataUpdatedAt,
      });
    } catch {}
  }
}

// ─── Prefetch manager ─────────────────────────────────────────────

type PrefetchFn = () => Promise<unknown>;

interface PrefetchQueue {
  fns: Array<{ priority: number; fn: PrefetchFn }>;
}

const prefetchQueues = new Map<string, PrefetchQueue>();

export function enqueuePrefetch(group: string, priority: number, fn: PrefetchFn) {
  let q = prefetchQueues.get(group);
  if (!q) {
    q = { fns: [] };
    prefetchQueues.set(group, q);
  }
  q.fns.push({ priority, fn });
}

export function flushPrefetch(group: string) {
  const q = prefetchQueues.get(group);
  if (!q) return;
  q.fns.sort((a, b) => b.priority - a.priority); // highest first
  // Execute with a small stagger to avoid network contention
  q.fns.forEach(({ fn }, i) => {
    setTimeout(() => fn(), i * 80);
  });
  q.fns = [];
}

// ─── Factory ──────────────────────────────────────────────────────

export function createQueryClient() {
  const gcTime = getConnectionSpeed() === "slow" ? 60 * 60_000 : 10 * 60_000;

  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: getStaleTime(5 * 60_000),
        gcTime,
        retry: 2,
        retryDelay: (attempt) => Math.min(500 * Math.pow(2, attempt), 5000),
        refetchOnWindowFocus: false, // avoid distracting refreshes
        refetchOnReconnect: true,    // do refresh on reconnect
      },
    },
  });

  return client;
}

// ─── Exported helpers for per-query config ────────────────────────

export { getStaleTime };

export const QUERY_PRESETS = {
  // Page-wide queries (list data — changes moderately often)
  page: (base: number = 5 * 60_000) => ({
    staleTime: getStaleTime(base),
    gcTime: getConnectionSpeed() === "slow" ? 60 * 60_000 : 15 * 60_000,
  }),

  // Detail queries (single item — changes rarely)
  detail: (base: number = 30 * 60_000) => ({
    staleTime: getStaleTime(base),
    gcTime: getConnectionSpeed() === "slow" ? 60 * 60_000 : 30 * 60_000,
  }),

  // Instant-search / suggestions (changes fast)
  search: () => ({
    staleTime: getStaleTime(15_000),
    gcTime: 60_000,
  }),

  // Stats / aggregated data (changes very slowly)
  stats: () => ({
    staleTime: getStaleTime(60 * 60_000),
    gcTime: 120 * 60_000,
  }),
} as const;
