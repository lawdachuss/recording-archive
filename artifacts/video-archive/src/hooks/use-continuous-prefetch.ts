import { useEffect, useRef, useCallback } from "react";
import { proxyUrl } from "@/lib/proxy-url";
import { preloadImage, preloadRecordingSprites, isReachablePreviewUrl } from "@/lib/preload-sprite";
import { isConnectionConstrained } from "@/lib/connection";

export interface ContinuousPrefetchOptions {
  /**
   * Fetch the recordings for a given 1-based page. Return null when there are
   * no more pages. The hook calls this to learn the upcoming page's thumbnail
   * URLs so it can warm them before the user scrolls.
   */
  fetchPage: (page: number) => Promise<Array<{
    id: string | number;
    thumbnail_url?: string | null;
    sprite_url?: string | null;
    preview_url?: string | null;
  }> | null>;
  /** Current visible page (1-based). */
  currentPage: number;
  /** How many pages ahead to keep ready. 1 = prefetch the very next page. */
  prefetchAhead?: number;
  /** Thumbnails to eagerly pull (high priority) from each prefetched page. */
  eagerThumbs?: number;
  /** Root margin for the IntersectionObserver (start early, in px). */
  rootMargin?: string;
}

/**
 * Continuous, scroll-aware background prefetch.
 *
 * Watches a sentinel element (returned as `sentinelRef` — place it at the end
 * of the grid). When the user nears the bottom, it fetches the next page's
 * metadata and warms its thumbnails (first `eagerThumbs` at high priority) plus
 * sprites/previews, so the next page renders instantly. Bounded by connection
 * quality (preload-sprite paces everything) and never double-fetches a page.
 */
export function useContinuousPrefetch({
  fetchPage,
  currentPage,
  prefetchAhead = 1,
  eagerThumbs = 10,
  rootMargin = "800px 0px",
}: ContinuousPrefetchOptions) {
  const lastPrefetched = useRef(currentPage);
  const busy = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const prefetchFrom = useCallback(
    async (startPage: number) => {
      if (busy.current) return;
      busy.current = true;
      try {
        let page = startPage;
        for (let i = 0; i < prefetchAhead; i++) {
          const target = page + 1;
          const recs = await fetchPage(target);
          if (!recs || recs.length === 0) break; // no more pages
          // Eagerly warm the first screen of thumbnails at high priority.
          recs.slice(0, eagerThumbs).forEach((rec) => {
            if (rec.thumbnail_url) {
              preloadImage(proxyUrl(rec.thumbnail_url), { priority: 3, immediate: true });
            }
          });
          // Sprites + previews for the whole page (best-effort, lower priority).
          preloadRecordingSprites(recs.slice(eagerThumbs));
          recs
            .filter((r) => r.preview_url && isReachablePreviewUrl(r.preview_url))
            .slice(0, eagerThumbs)
            .forEach((r) => preloadImage(proxyUrl(r.preview_url), { priority: 1 }));
          lastPrefetched.current = target;
          page = target;
        }
      } catch {
        /* best-effort */
      } finally {
        busy.current = false;
      }
    },
    [fetchPage, prefetchAhead, eagerThumbs],
  );

  // When the visible page advances, keep the lookahead window ahead of it.
  useEffect(() => {
    if (currentPage > lastPrefetched.current) {
      lastPrefetched.current = currentPage;
      prefetchFrom(currentPage);
    }
  }, [currentPage, prefetchFrom]);

  // Scroll sentinel — start warming before the user reaches the end.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || isConnectionConstrained()) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          prefetchFrom(lastPrefetched.current);
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [prefetchFrom, rootMargin]);

  return { sentinelRef };
}
