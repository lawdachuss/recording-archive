import { useEffect, useRef, useCallback } from "react";
import { proxyImageUrl } from "@/lib/proxy-url";
import { preloadImage, preloadRecordingMedia } from "@/lib/preload-sprite";
import { isConnectionConstrained } from "@/lib/connection";
import {
  createPrefetchWindow,
  planPages,
  markWarmed,
  syncQuery,
  type PrefetchWindow,
} from "@/lib/prefetch-window";

export interface ContinuousPrefetchOptions {
  /**
   * Fetch the recordings for a given 1-based page. Return an empty array
   * when there are no more pages (the window then treats that page as
   * terminal and stops refetching it). Throw on transient failures — those
   * are retried on the next trigger.
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
  /**
   * Signature of the CURRENT query (filters/sort/search, without the page).
   * When it changes the lookahead window is reset — pages warmed for the old
   * result set must not be counted as warm for the new one, otherwise
   * prefetching dies for the new query until the user scrolls past the old
   * high-water mark.
   */
  resetKey?: string;
}

/**
 * Far pages only eagerly warm ONE screen of thumbnails (not the whole page),
 * so several lookahead pages can never flood the immediate queue ahead of the
 * near pages' sprites.
 */
const FAR_EAGER_THUMB_CAP = 16;

/**
 * Continuous, scroll-aware background prefetch.
 *
 * Watches a sentinel element (returned as `sentinelRef` — place it at the end
 * of the grid). When the user nears the bottom, it fetches the next pages'
 * metadata IN PARALLEL and warms their media so navigating + hovering is instant:
 *   - the very next page gets its ENTIRE thumbnail set eager (paint-instant)
 *     plus full media (sprites + animated previews);
 *   - near lookahead pages (within `previewDepth`) get full warm
 *     (sprites immediate + previews);
 *   - far lookahead pages get thumbnails + sprites only (no previews).
 *
 * All `prefetchAhead` pages are fetched concurrently (Promise.all) rather than
 * serially, so warming begins in ~1 API RTT instead of `prefetchAhead` RTTs.
 *
 * The window (see lib/prefetch-window.ts) guarantees:
 *   - no page is fetched twice within a query;
 *   - an empty page (past the end of results) is terminal — triggers stop
 *     refetching a page that does not exist;
 *   - changing filters/sort/search (resetKey) resets the window so the new
 *     result set is warmed from scratch.
 *
 * Bounded by connection quality (skipped entirely on constrained links).
 * Stale runs are cancelled via AbortController when a new trigger fires
 * (e.g. fast scroll or a filter change) so the queue is always fresh — the
 * React Query cache still keeps their downloaded data (see Browse's
 * ensureQueryData-backed fetchPage), only the media warm is dropped.
 */
export function useContinuousPrefetch({
  fetchPage,
  currentPage,
  prefetchAhead = 1,
  previewDepth = 2,
  eagerThumbs = 10,
  rootMargin = "800px 0px",
  startSignal,
  resetKey,
}: ContinuousPrefetchOptions) {
  // Lookahead window: lazily initialised once (ref initializers run every
  // render, so guard instead of calling createPrefetchWindow inline).
  const winRef = useRef<PrefetchWindow | null>(null);
  if (winRef.current === null) {
    winRef.current = createPrefetchWindow(currentPage, resetKey ?? "");
  }
  const win = winRef.current;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // AbortController for the current in-flight prefetch run. When a new trigger
  // fires we cancel the stale run immediately and start fresh.
  const abortRef = useRef<AbortController | null>(null);

  const prefetchFrom = useCallback(
    async (startPage: number) => {
      // Constrained links skip lookahead entirely — the current page's
      // viewport sprites are still warmed by useHoverPreview (small files).
      if (isConnectionConstrained()) return;

      // Nothing new to fetch (everything is already warm) — do NOT abort the
      // in-flight run: a background refetch emitting a fresh startSignal used
      // to cancel a perfectly good run and never replace it, leaving the
      // lookahead media cold.
      const planned = planPages(win, startPage, prefetchAhead);
      if (planned.length === 0) return;

      // Cancel any in-flight run that is now stale (filter change, fast scroll).
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;

      try {
        // Fetch all needed pages concurrently. Individual failures are swallowed
        // so one slow/broken page doesn't block the others.
        const results = await Promise.all(
          planned.map(async (target) => {
            const idx = target - startPage - 1;
            try {
              if (signal.aborted) return null;
              const recs = await fetchPage(target);
              if (signal.aborted) return null;
              return { target, near: idx < previewDepth, idx, recs };
            } catch {
              return null; // transient failure — retried on the next trigger
            }
          }),
        );

        if (signal.aborted) return;

        // Results are ordered by page. The first empty page means "past the
        // end of this result set" — mark it (and everything after it) warm so
        // future triggers don't refetch pages that do not exist.
        let endReached = false;
        for (const result of results) {
          if (!result) continue;
          const { target, near, idx, recs } = result;

          if (endReached || !recs || recs.length === 0) {
            endReached = true;
            markWarmed(win, target);
            continue;
          }

          // The very next page: eagerly warm ALL its thumbnails so navigation
          // lands on a painted grid. Later pages eager only one screen — the
          // rest of their thumbs warm in the background behind the sprites.
          const eagerCount = idx === 0 ? recs.length : Math.min(eagerThumbs, FAR_EAGER_THUMB_CAP);
          recs.slice(0, eagerCount).forEach((rec) => {
            if (rec.thumbnail_url) {
              preloadImage(proxyImageUrl(rec.thumbnail_url), { priority: 3, immediate: true });
            }
          });

          // Warm sprites (+ animated previews on near pages) for the WHOLE
          // page. The old `recs.slice(eagerThumbs)` was ALWAYS EMPTY whenever
          // eagerThumbs >= page size (Browse passes ITEMS_PER_PAGE), so
          // lookahead pages silently got thumbnails only — no sprites, no
          // previews — and hover on pages 2-6 was cold. preloadRecordingMedia
          // re-enqueues the eager thumbs as background (deduped by URL) and
          // keeps them non-immediate, so sprites ride the immediate queue in
          // front of the remaining thumbnail tail.
          if (near) {
            preloadRecordingMedia(recs, { immediate: true });
          } else {
            // Far lookahead: thumbnail + sprite warming only — previews are
            // skipped to avoid hundreds of speculative webp downloads for
            // pages several scrolls away.
            preloadRecordingMedia(recs, { skipPreviews: true });
          }

          markWarmed(win, target);
        }
      } catch (err: unknown) {
        // Ignore AbortError — that's an expected cancellation, not a real error.
        if (err instanceof Error && err.name === "AbortError") return;
        /* other errors: best-effort */
      }
    },
    [fetchPage, prefetchAhead, previewDepth, eagerThumbs, win],
  );

  // When the visible page advances, slide the lookahead window ahead of it.
  useEffect(() => {
    if (currentPage > win.highWater) {
      markWarmed(win, currentPage);
      prefetchFrom(currentPage);
    }
  }, [currentPage, prefetchFrom, win]);

  // Query/filter/sort change → reset the window so the NEW result set's next
  // pages are planned (old bug: the previous query's high-water mark kept
  // skipping them, killing prefetch after any filter change).
  useEffect(() => {
    if (syncQuery(win, resetKey ?? "", currentPage)) {
      prefetchFrom(currentPage);
    }
  }, [resetKey, currentPage, prefetchFrom, win]);

  // Prime the next page as soon as the current page's data is available —
  // without waiting for the user to scroll to the sentinel. This is what
  // makes pagination land on warm thumbnails instead of a cold grid.
  // Fire unconditionally when startSignal changes (as long as it's truthy)
  // so the warm always reflects the latest page data.
  useEffect(() => {
    if (!startSignal) return;
    // Always attempt a warm when fresh data arrives; prefetchFrom internally
    // skips pages already tracked in the window.
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
          prefetchFrom(win.highWater);
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [prefetchFrom, rootMargin, win]);

  // Cancel any in-flight prefetch when the hook unmounts (e.g. navigation).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { sentinelRef };
}
