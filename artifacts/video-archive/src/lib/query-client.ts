/**
 * query-client.ts — enhanced QueryClient with persistence and network-aware
 * stale times.
 *
 * Persists the React Query cache to localStorage so in-flight and cached
 * data survives full page reloads (not just soft navigations).
 *
 * Network-aware stale times:
 *   - Slow connection (saveData / 2g-class / < 1 Mbps) → staleTime 30m
 *   - Fast connection → per-query configured value
 */

import { QueryClient, onlineManager, keepPreviousData } from "@tanstack/react-query";
import { cacheGetSync, cacheSetLocal, cacheGetLocal, cacheDelete } from "./cache";
import { isConnectionConstrained } from "./connection";

const PERSIST_KEY = "vault-rq-cache";
const PERSIST_TTL = 2 * 60 * 60_000; // persist cache snapshot for 2h — instant restore on reloads

/**
 * Query keys that must NEVER be persisted across reloads/sessions: they carry
 * authenticated or per-session data (bookmarks, history, notifications, watch
 * later, reactions/comments with the current viewer's state, premium status).
 * Persisting them would let the next visitor on a shared browser see the
 * previous user's private data.
 */
const SENSITIVE_QUERY_PREFIXES = new Set([
  "user",
  "premium",
  "my-requests",
  "recommendations",
  "reactions",
  "comments",
]);

function isSensitiveKey(queryKey: readonly unknown[]): boolean {
  if (queryKey.length === 0) return false;
  const first = queryKey[0];
  return typeof first === "string" && SENSITIVE_QUERY_PREFIXES.has(first);
}

// ─── Network detection ────────────────────────────────────────────

type ConnectionSpeed = "slow" | "fast";

// Single source of truth: lib/connection.ts reads saveData / effectiveType /
// downlink. This used to duplicate a weaker check that only looked at
// effectiveType, so query prefetching disagreed with the preload queue about
// what counts as a constrained link (saveData and < 1 Mbps were ignored).
function getConnectionSpeed(): ConnectionSpeed {
  return isConnectionConstrained() ? "slow" : "fast";
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
      if (isSensitiveKey(q.queryKey)) continue;
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
    // Use the TTL cache (switches to IndexedDB if payload > ~100KB).
    // Local-only: the snapshot contains authenticated, user-specific query
    // data and must never be written to the shared, CDN-cached edge tier.
    cacheSetLocal(PERSIST_KEY, payload, PERSIST_TTL);
  }
}

/**
 * Restore a previously persisted query cache.
 */
export function restoreQueryCache(queryClient: QueryClient) {
  // Try sync first (fastest path — works for small caches).
  // cacheGetSync handles TTL expiry internally via lsGet.
  let persisted = cacheGetSync<PersistedCache>(PERSIST_KEY);
  if (!persisted) {
// Cache miss from sync — schedule an async restore later
  setTimeout(async () => {
      try {
        const p = await cacheGetLocal<PersistedCache>(PERSIST_KEY);
        if (p) applyCache(queryClient, p);
      } catch {}
    }, 0);
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

// ─── Factory ──────────────────────────────────────────────────────

let globalClient: QueryClient | null = null;

/**
 * Wipe BOTH the in-memory query cache (so the next user on a shared browser
 * can't read the previous user's data before a refetch) AND the persisted
 * snapshot. Called from AuthContext.signOut.
 */
export async function clearQueryCache() {
  globalClient?.clear();
  await cacheDelete(PERSIST_KEY);
}

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

  globalClient = client;
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
  // Always use a short staleTime — even on slow connections, search
  // results must reflect recent data. The base 15s is already generous.
  search: () => ({
    staleTime: 15_000,
    gcTime: 60_000,
  }),

  // Stats / aggregated data (changes very slowly)
  stats: () => ({
    staleTime: getStaleTime(60 * 60_000),
    gcTime: 120 * 60_000,
  }),
} as const;

// ─── Stale-While-Revalidate Helper ───────────────────────────────

/**
 * Configuration for stale-while-revalidate behavior.
 * Used with useSWRQuery to serve cached data instantly while
 * background-fetching fresh data.
 */
export interface SWROptions {
  /** Serve cached data for this long before considering it stale (ms) */
  dedupingInterval?: number;
  /** Don't revalidate more often than this (ms) */
  focusThrottleInterval?: number;
  /** Keep previous data while fetching new data */
  keepPreviousData?: boolean;
}

const DEFAULT_SWR_OPTIONS: Required<SWROptions> = {
  dedupingInterval: 2000,
  focusThrottleInterval: 5000,
  keepPreviousData: true,
};

/**
 * Get SWR-optimized query options for a given preset.
 * Combines the preset's stale/gc times with SWR-specific options.
 *
 * Usage:
 *   const opts = getSWROptions('page');
 *   useQuery({ queryKey: [...], queryFn: ..., ...opts });
 */
export function getSWROptions(
  preset: keyof typeof QUERY_PRESETS,
  overrides?: SWROptions,
): {
  staleTime: number;
  gcTime: number;
  refetchOnWindowFocus: boolean;
  keepPreviousData: boolean;
  placeholderData: typeof keepPreviousData | undefined;
  dedupingInterval: number;
  focusThrottleInterval: number;
} {
  const base = QUERY_PRESETS[preset]();
  const swr = { ...DEFAULT_SWR_OPTIONS, ...overrides };
  return {
    ...base,
    refetchOnWindowFocus: false,
    keepPreviousData: swr.keepPreviousData,
    placeholderData: swr.keepPreviousData ? keepPreviousData : undefined,
    dedupingInterval: swr.dedupingInterval,
    focusThrottleInterval: swr.focusThrottleInterval,
  };
}
