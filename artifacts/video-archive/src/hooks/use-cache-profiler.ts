/**
 * use-cache-profiler.ts — Real-time cache profiling hook
 *
 * Polls the cache profiling counters at a configurable interval and returns
 * a snapshot of hit rates, timing, and category breakdowns.
 *
 * Usage:
 *   const stats = useCacheProfiler(2000); // poll every 2s
 *   console.log(stats.memoryHitRate, stats.overallHitRate);
 *
 * For manual console access:
 *   window.__cacheProfile()     — get current snapshot
 *   window.__cacheProfileReset() — reset all counters
 */

import { useState, useEffect, useRef } from "react";
import { getCacheProfile, type CacheProfile } from "@/lib/image-cache";

export type { CacheProfile };

const DEFAULT_INTERVAL_MS = 2000;

export function useCacheProfiler(intervalMs = DEFAULT_INTERVAL_MS): CacheProfile | null {
  const [snapshot, setSnapshot] = useState<CacheProfile | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Initial snapshot
    setSnapshot(getCacheProfile());

    // Poll at interval
    timerRef.current = window.setInterval(() => {
      setSnapshot(getCacheProfile());
    }, intervalMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [intervalMs]);

  return snapshot;
}
