import { useEffect, useRef, useCallback } from "react";
import { proxyImageUrl } from "@/lib/proxy-url";
import { preloadImage, preloadRecordingMedia } from "@/lib/preload-sprite";
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
  /**
   * Page offset (from the current page) that still gets FULL warm (thumbnails
   * + sprites + animated previews). Pages beyond this warm thumbnails + sprites
   * only — far-away previews are hundreds of KB each and unlikely to be the
   * next hover, so we don't download them speculatively.
   */
  previewDepth?: number;
  /** Thumbnails to eagerly pull (high priority) from each prefetched page. */
  eagerThumbs?: number;
  /** Root margin for the IntersectionObserver (start early, in px). */
  rootMargin?: string;
  /**
   * When provided, warming begins as soon as this value becomes truthy and
   * again whenever it changes — e.g. pass the current page's query data so
   * the next page's thumbnails are primed before the user scrolls or clicks.
   */
  startSignal?: unknown;
}

/**
 * Continuous, scroll-aware background prefetch.
 *
 * Watches a sentinel element (returned as `sentinelRef` — place it at the end
 * of the grid). When the user nears the bottom, it fetches the next pages'
 * metadata IN PARALLEL and warms their media so navigating + hovering is instant:
 *   - the very next page gets its ENTIRE thumbnail set eager (paint-instant)
 *     plus full media (sprites + animated previews);
 *   - near lookahead pages (within `previewDepth`) get full warm;
 *   - far lookahead pages get thumbnails + sprites only (no previews).
 *
 * All `prefetchAhead` pages are fetched concurrently (Promise.all) rather than
 * serially, so warming begins in ~1 API RTT instead of `prefetchAhead` RTTs.
 *
 * Bounded by connection quality (skipped entirely on constrained links) and
 * never double-fetches a page. Stale runs are cancelled via AbortController
 * when a new trigger fires (e.g. fast scroll) so the queue is always fresh.
 */
export function useContinuousPrefetch({
  fetchPage,
  currentPage,
  prefetchAhead = 1,
  previewDepth = 2,
  eagerThumbs = 10,
  rootMargin = "800px 0px",
  startSignal,
}: ContinuousPrefetchOptions) {
  const lastPrefetched = useRef(currentPage);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // AbortController for the current in-flight prefetch run. When a new trigger
  // fires we cancel the stale run immediately and start fresh.
  const abortRef = useRef<AbortController | null>(null);

  const prefetchFrom = useCallback(
    async (startPage: number) => {
      // Constrained links skip lookahead entirely — the current page's
      // viewport sprites are still warmed by useHoverPreview (small files).
      if (isConnectionConstrained()) return;

      // Cancel any in-flight run that is now stale.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;

      try {
        // Build the list of pages we need to fetch. We fetch all of them IN
        // PARALLEL so warming begins after a single API RTT, not `prefetchAhead`
        // RTTs. Each page that has already been prefetched is skipped.
        const pagesToFetch: Array<{ target: number; near: boolean; idx: number }> = [];
        for (let i = 0; i < prefetchAhead; i++) {
          const target = startPage + 1 + i;
          if (target <= lastPrefetched.current) continue; // already warmed
          pagesToFetch.push({ target, near: i < previewDepth, idx: i });
        }

        if (pagesToFetch.length === 0) return;

        // Fetch all needed pages concurrently. Individual failures are swallowed
        // so one slow/broken page doesn't block the others.
        const results = await Promise.all(
          pagesToFetch.map(async ({ target, near, idx }) => {
            try {
              if (signal.aborted) return null;
              const recs = await fetchPage(target);
              if (signal.aborted) return null;
              return { target, near, idx, recs };
            } catch {
              return null;
            }
          }),
        );

        if (signal.aborted) return;

        // Process results: warm media for each page that returned data.
        for (const result of results) {
          if (!result) continue;
          const { target, near, idx, recs } = result;
          if (!recs || recs.length === 0) continue;

          // The very next page: eagerly warm ALL its thumbnails so navigation
          // lands on a painted grid. Later pages eager only the first screen.
          const eagerCount = idx === 0 ? recs.length : eagerThumbs;
          recs.slice(0, eagerCount).forEach((rec) => {
            if (rec.thumbnail_url) {
              preloadImage(proxyImageUrl(rec.thumbnail_url), { priority: 3, immediate: true });
            }
          });
          if (near) {
            // Full media: remaining thumbnails (background) + sprites +
            // animated previews for the pages the user actually reaches next.
            preloadRecordingMedia(recs.slice(eagerThumbs));
          } else {
            // Far lookahead: thumbnail + sprite warming only — previews are
            // skipped to avoid hundreds of speculative webp downloads for
            // pages several scrolls away.
            preloadRecordingMedia(recs.slice(eagerThumbs), { skipPreviews: true });
          }

          // Track the highest page we've successfully prefetched so we don't
          // re-fetch it on the next scroll trigger.
          if (target > lastPrefetched.current) {
            lastPrefetched.current = target;
          }
        }
      } catch (err: unknown) {
        // Ignore AbortError — that's an expected cancellation, not a real error.
        if (err instanceof Error && err.name === "AbortError") return;
        /* other errors: best-effort */
      }
    },
    [fetchPage, prefetchAhead, previewDepth, eagerThumbs],
  );

  // When the visible page advances, slide the lookahead window ahead of it.
  useEffect(() => {
    if (currentPage > lastPrefetched.current) {
      lastPrefetched.current = currentPage;
      prefetchFrom(currentPage);
    }
  }, [currentPage, prefetchFrom]);

  // Prime the next page as soon as the current page's data is available —
  // without waiting for the user to scroll to the sentinel. This is what
  // makes pagination land on warm thumbnails instead of a cold grid.
  // Fire unconditionally when startSignal changes (as long as it's truthy)
  // so the warm always reflects the latest page data.
  useEffect(() => {
    if (!startSignal) return;
    // Always attempt a warm when fresh data arrives; prefetchFrom internally
    // skips pages already tracked in lastPrefetched.
    prefetchFrom(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal, currentPage]);

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

  // Cancel any in-flight prefetch when the hook unmounts (e.g. navigation).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { sentinelRef };
}
