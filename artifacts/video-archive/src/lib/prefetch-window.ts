/**
 * prefetch-window.ts — pure bookkeeping for the continuous page prefetch.
 *
 * The lookahead window tracks the highest page number that has been warmed
 * for the CURRENT query (filters/sort/search). Keeping it as a tiny pure
 * state machine means the reset-on-filter-change and end-of-results semantics
 * are unit-testable without a DOM or network.
 *
 * Semantics:
 *   - `highWater` only ever moves forward within one query (markWarmed).
 *   - When the query signature changes (syncQuery), the window is reset to
 *     `currentPage` so the NEW result set gets its next pages warmed — the
 *     old bug was keeping the high-water mark across filter changes, which
 *     left prefetching permanently dead for the new query.
 *   - A page that returned no rows (past the end of the results) is marked
 *     like any other page, so triggers stop refetching a page that does not
 *     exist.
 */

export interface PrefetchWindow {
  /** Highest page already warmed for `queryKey`. Pages ≤ this are skipped. */
  highWater: number;
  /** Signature of the query (filters/sort/search) the window belongs to. */
  queryKey: string;
}

/** Create a window whose current page is already considered warm. */
export function createPrefetchWindow(currentPage = 1, queryKey = ""): PrefetchWindow {
  return { highWater: Math.max(1, currentPage), queryKey };
}

/**
 * Pages in `(startPage, startPage + prefetchAhead]` that still need fetching,
 * ascending. Pages at or below the high-water mark are skipped.
 */
export function planPages(
  win: PrefetchWindow,
  startPage: number,
  prefetchAhead: number,
): number[] {
  const pages: number[] = [];
  for (let i = 0; i < prefetchAhead; i++) {
    const target = startPage + 1 + i;
    if (target <= win.highWater) continue;
    pages.push(target);
  }
  return pages;
}

/** Mark a page as warmed. The high-water mark never moves backwards. */
export function markWarmed(win: PrefetchWindow, page: number): void {
  if (page > win.highWater) win.highWater = page;
}

/**
 * Re-key the window for a new query (filter/sort/search change).
 * Returns true when a reset happened (queryKey changed) — callers should
 * restart the prefetch from `currentPage`.
 */
export function syncQuery(win: PrefetchWindow, queryKey: string, currentPage: number): boolean {
  if (win.queryKey === queryKey) return false;
  win.queryKey = queryKey;
  win.highWater = Math.max(1, currentPage);
  return true;
}
