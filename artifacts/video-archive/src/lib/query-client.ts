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

import { QueryClient, onlineManager, keepPreviousData } from "@tanstack/react-query";
import { cacheGetSync, cacheSet, CACHE_TTL } from "./cache";

const PERSIST_KEY = "vault-rq-cache";
const PERSIST_TTL = 2 * 60 * 60_000; // persist cache snapshot for 2h — instant restore on reloads

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
  // Try sync first (fastest path — works for small caches).
  // cacheGetSync handles TTL expiry internally via lsGet.
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
  // Execute with a small stagger to avoid network contention.
  // Catch errors to prevent unhandled promise rejections from failed prefetches.
  q.fns.forEach(({ fn }, i) => {
    setTimeout(() => fn().catch(() => {}), i * 80);
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

// ─── Viewport-Aware Intelligent Prefetch ─────────────────────────

interface ViewportPrefetchEntry {
  url: string;
  priority: number; // 1-10, higher = more important
  estimatedSize: number; // bytes
  enqueuedAt: number;
  element?: HTMLElement; // optional DOM element for proximity calc
}

const viewportPrefetchQueue: ViewportPrefetchEntry[] = [];
let viewportPrefetchActive = false;
const MAX_CONCURRENT_VIEWPORT_PREFETCHES = 4;
let activeViewportPrefetches = 0;

/**
 * Get the distance from an element to the viewport center.
 * Returns 0 if the element is in the viewport, Infinity if not found.
 */
function getDistanceToViewport(element?: HTMLElement): number {
  if (!element || typeof window === "undefined") return Infinity;
  const rect = element.getBoundingClientRect();
  const viewportCenter = window.innerHeight / 2;
  const elementCenter = rect.top + rect.height / 2;
  return Math.abs(viewportCenter - elementCenter);
}

/**
 * Enqueue a URL for viewport-aware prefetching. The priority is dynamically
 * adjusted based on the element's proximity to the viewport.
 *
 * @param url - The URL to prefetch
n * @param basePriority - Base priority (1-10)
 * @param estimatedSize - Estimated response size in bytes
 * @param element - Optional DOM element for proximity-based priority boost
 */
export function enqueueViewportPrefetch(
  url: string,
  basePriority: number,
  estimatedSize: number,
  element?: HTMLElement,
): void {
  // Don't prefetch on slow connections
  if (getConnectionSpeed() === "slow") return;

  // Deduplicate
  if (viewportPrefetchQueue.some((e) => e.url === url)) return;

  const entry: ViewportPrefetchEntry = {
    url,
    priority: basePriority,
    estimatedSize,
    enqueuedAt: Date.now(),
    element,
  };

  viewportPrefetchQueue.push(entry);
  processViewportPrefetchQueue();
}

/**
 * Process the viewport prefetch queue, prioritizing items closest
 * to the viewport and deprioritizing items that have been waiting too long.
 */
function processViewportPrefetchQueue(): void {
  if (viewportPrefetchActive) return;
  if (activeViewportPrefetches >= MAX_CONCURRENT_VIEWPORT_PREFETCHES) return;
  if (viewportPrefetchQueue.length === 0) return;

  viewportPrefetchActive = true;

  // Sort by dynamic priority: base priority + proximity boost - age penalty
  const now = Date.now();
  viewportPrefetchQueue.sort((a, b) => {
    const distA = getDistanceToViewport(a.element);
    const distB = getDistanceToViewport(b.element);
    
    // Proximity boost: items in/near viewport get +5 priority
    const boostA = distA < window.innerHeight ? 5 : distA < window.innerHeight * 2 ? 2 : 0;
    const boostB = distB < window.innerHeight ? 5 : distB < window.innerHeight * 2 ? 2 : 0;
    
    // Age penalty: items waiting >5s lose 1 priority per second
    const ageA = Math.min(5, (now - a.enqueuedAt) / 1000);
    const ageB = Math.min(5, (now - b.enqueuedAt) / 1000);
    
    const scoreA = a.priority + boostA - ageA;
    const scoreB = b.priority + boostB - ageB;
    
    return scoreB - scoreA; // higher score = higher priority
  });

  // Start prefetches up to concurrency limit
  while (
    viewportPrefetchQueue.length > 0 &&
    activeViewportPrefetches < MAX_CONCURRENT_VIEWPORT_PREFETCHES
  ) {
    const entry = viewportPrefetchQueue.shift()!;
    activeViewportPrefetches++;

    // Fire-and-forget prefetch with dedup
    const img = new Image();
    img.src = entry.url;
    img.onload = img.onerror = () => {
      activeViewportPrefetches--;
      viewportPrefetchActive = false;
      processViewportPrefetchQueue();
    };
  }

  viewportPrefetchActive = false;
}

/**
 * Clear the viewport prefetch queue (e.g., on navigation).
 */
export function clearViewportPrefetchQueue(): void {
  viewportPrefetchQueue.length = 0;
  activeViewportPrefetches = 0;
  viewportPrefetchActive = false;
}

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
