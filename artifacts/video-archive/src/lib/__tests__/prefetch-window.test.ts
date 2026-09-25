import { describe, it, expect } from "vitest";
import {
  createPrefetchWindow,
  planPages,
  markWarmed,
  syncQuery,
} from "../prefetch-window";

describe("createPrefetchWindow", () => {
  it("treats the current page as already warm", () => {
    const win = createPrefetchWindow(3, "q1");
    expect(win.highWater).toBe(3);
    expect(win.queryKey).toBe("q1");
  });

  it("clamps page 0/negative to 1", () => {
    expect(createPrefetchWindow(0).highWater).toBe(1);
    expect(createPrefetchWindow(-4).highWater).toBe(1);
  });
});

describe("planPages", () => {
  it("plans the pages ahead of startPage", () => {
    const win = createPrefetchWindow(1, "q");
    expect(planPages(win, 1, 5)).toEqual([2, 3, 4, 5, 6]);
  });

  it("skips pages at or below the high-water mark", () => {
    const win = createPrefetchWindow(1, "q");
    markWarmed(win, 4);
    expect(planPages(win, 1, 5)).toEqual([5, 6]);
  });

  it("returns nothing when the whole window is already warm", () => {
    const win = createPrefetchWindow(1, "q");
    markWarmed(win, 10);
    expect(planPages(win, 1, 5)).toEqual([]);
    expect(planPages(win, 6, 5)).toEqual([11]); // only the page beyond the mark
    expect(planPages(win, 10, 5)).toEqual([11, 12, 13, 14, 15]);
  });

  it("plans beyond the high-water mark after a forward jump", () => {
    const win = createPrefetchWindow(1, "q");
    markWarmed(win, 6);
    // User jumped to page 10 — window slides forward with them.
    markWarmed(win, 10);
    expect(planPages(win, 10, 3)).toEqual([11, 12, 13]);
  });
});

describe("markWarmed", () => {
  it("only ever moves the high-water mark forward", () => {
    const win = createPrefetchWindow(1, "q");
    markWarmed(win, 5);
    expect(win.highWater).toBe(5);
    markWarmed(win, 3); // back-navigation must not regress the window
    expect(win.highWater).toBe(5);
    markWarmed(win, 7);
    expect(win.highWater).toBe(7);
  });

  it("marks an end-of-results page so it is never re-planned", () => {
    const win = createPrefetchWindow(1, "q");
    markWarmed(win, 3); // page 3 came back empty (past the end)
    expect(planPages(win, 1, 5)).toEqual([4, 5, 6]);
  });
});

describe("syncQuery", () => {
  it("is a no-op while the query signature is unchanged", () => {
    const win = createPrefetchWindow(1, "filters-a");
    markWarmed(win, 6);
    expect(syncQuery(win, "filters-a", 1)).toBe(false);
    expect(win.highWater).toBe(6); // page advance within one query keeps warm pages
  });

  it("resets the window to currentPage when filters change", () => {
    const win = createPrefetchWindow(1, "filters-a");
    markWarmed(win, 6);
    // User changes sort → page resets to 1 with a new result set.
    expect(syncQuery(win, "filters-b", 1)).toBe(true);
    expect(win.queryKey).toBe("filters-b");
    expect(win.highWater).toBe(1);
    // The NEW query's next pages are planned again (the old bug: pages 2–6
    // stayed "warm" from the previous query, killing prefetch entirely).
    expect(planPages(win, 1, 5)).toEqual([2, 3, 4, 5, 6]);
  });

  it("keeps warm pages when the user stays on the same query", () => {
    const win = createPrefetchWindow(5, "filters-a");
    markWarmed(win, 8);
    // Page-URL changes that don't touch filters re-sync with the same key.
    expect(syncQuery(win, "filters-a", 5)).toBe(false);
    expect(win.highWater).toBe(8);
  });
});
