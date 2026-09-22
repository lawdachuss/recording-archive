/**
 * catalog-warmer.ts — bounded, connection-aware catalog media preloader.
 *
 * After first paint, warms the catalog's hot set (the first couple of pages)
 * so scrolling and repeat visits are instant. Deliberately BOUNDED — the old
 * version warmed ~1000 sprites AND eagerly downloaded ~1000 full preview
 * videos a few seconds after page load, saturating the connection and slowing
 * the grid for minutes.
 *
 * - Sprites, thumbnails, and ANIMATED previews are warmed — all small files
 *   that make grid paint + hover instant-on-repeat. Real VIDEO previews
 *   (.mp4/.webm, multi-MB) are NOT warmed; warming hundreds saturates the
 *   connection. Previews load on demand: cards near the viewport preload
 *   their own preview via useHoverPreview, and the global cap in
 *   preload-preview.ts bounds those speculative downloads.
 * - Only MAX_PAGES × PAGE_SIZE recordings are warmed (100) — the catalog's
 *   first page, i.e. the hot set. Deeper recordings warm on demand when
 *   scrolled to.
 * - The warmup also does NOT start right after page load: App schedules it
 *   ~20s in via idle callback, so it never competes with first paint or the
 *   user's first few scrolls.
 * - Everything routes through preload-sprite's single paced queue, so outbound
 *   media requests have exactly one coordination point.
 */

import { listRecordings } from "@workspace/api-client-react";
import { preloadRecordingMedia } from "@/lib/preload-sprite";
import { evictIfNeeded } from "@/lib/image-cache";
import { isConnectionConstrained } from "@/lib/connection";

// ─── Config ────────────────────────────────────────────────────────────────
const WARM_MARKER = "catalog.warmUntil";
const WARM_REINTERVAL_MS = 6 * 60 * 60 * 1000; // re-warm at most every 6h
const PAGE_SIZE = 100;
const MAX_PAGES = 1; // 100 recordings — the catalog's first page only
const PARALLEL_FETCHES = 3; // fetch 3 pages concurrently

// ─── Progress state (reactive) ─────────────────────────────────────────────
export interface WarmProgress {
  phase: "idle" | "fetching" | "warming" | "done";
  pagesLoaded: number;
  totalPages: number;
  recordingsProcessed: number; // how many recordings we've scheduled media for
  totalRecordings: number; // running estimate of total
  thumbnailsLoaded: number; // thumbnails scheduled into the preload queue
  spritesLoaded: number; // sprites scheduled
  previewsLoaded: number; // previews scheduled
  currentConcurrency: number; // reserved (paced by preload-sprite)
  startedAt: number;
}

let progress: WarmProgress = {
  phase: "idle",
  pagesLoaded: 0,
  totalPages: MAX_PAGES,
  recordingsProcessed: 0,
  totalRecordings: MAX_PAGES * PAGE_SIZE,
  thumbnailsLoaded: 0,
  spritesLoaded: 0,
  previewsLoaded: 0,
  currentConcurrency: 0,
  startedAt: 0,
};

type ProgressListener = (p: WarmProgress) => void;
const listeners = new Set<ProgressListener>();

function updateProgress(patch: Partial<WarmProgress>) {
  progress = { ...progress, ...patch };
  listeners.forEach((l) => l(progress));
}

export function onWarmProgress(cb: ProgressListener): () => void {
  listeners.add(cb);
  cb(progress);
  return () => listeners.delete(cb);
}

export function getWarmProgress(): WarmProgress {
  return progress;
}

// ─── Cancellation ───────────────────────────────────────────────────────────
let warmupAbort = false;
export function cancelWarmup() {
  warmupAbort = true;
}

// ─── Page fetching (parallel, bounded) ──────────────────────────────────────
// fetchPagesInParallel: fetch pages [startPage..startPage+count-1] concurrently.
async function fetchPagesInParallel(
  startPage: number,
  count: number,
  _maxPages: number,
): Promise<Array<{ page: number; data: any[] }>> {
  const tasks = Array.from({ length: count }, (_, i) => {
    const page = startPage + i;
    return listRecordings({ page, limit: PAGE_SIZE })
      .then((res: any) => ({ page, data: res?.recordings ?? res?.data ?? [] }))
      .catch(() => ({ page, data: [] as any[] }));
  });
  return Promise.all(tasks);
}

/**
 * Start the background catalog warmup. Idempotent-ish via the warm marker:
 * skips if warmed within the interval. Safe to call on every mount.
 */
export async function startCatalogWarmup(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isConnectionConstrained()) return; // never warm on slow/metered links

  const last = Number(localStorage.getItem(WARM_MARKER) || 0);
  if (Date.now() - last < WARM_REINTERVAL_MS) return;

  warmupAbort = false;
  updateProgress({
    phase: "fetching",
    pagesLoaded: 0,
    recordingsProcessed: 0,
    thumbnailsLoaded: 0,
    spritesLoaded: 0,
    previewsLoaded: 0,
    startedAt: Date.now(),
  });

  // The outer scheduleIdleWork in App.tsx already waits ~20 s after first
  // paint before calling us. No additional delay is needed here — it only
  // added latency before the warm started. Individual inter-batch pauses
  // below use requestIdleCallback so they yield to user input naturally.
  if (warmupAbort) return;

  // Small helper: yield to the browser for one idle frame, or fall back to a
  // 200 ms timeout on browsers without requestIdleCallback (Safari ≤ 16).
  function yieldToIdle(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 500 });
      } else {
        window.setTimeout(resolve, 200);
      }
    });
  }

  let currentPage = 1;

  while (currentPage <= MAX_PAGES && !warmupAbort) {
    const batchSize = Math.min(PARALLEL_FETCHES, MAX_PAGES - currentPage + 1);
    const pages = await fetchPagesInParallel(currentPage, batchSize, MAX_PAGES);
    updateProgress({ phase: "warming" });

    let recordingsProcessed = progress.recordingsProcessed;
    let thumbnailsLoaded = progress.thumbnailsLoaded;
    let spritesLoaded = progress.spritesLoaded;
    let previewsLoaded = progress.previewsLoaded;
    let pagesLoaded = progress.pagesLoaded;

    for (const { data } of pages) {
      if (data.length === 0) {
        // Ran out of recordings — stop fetching further pages.
        currentPage = MAX_PAGES + 1;
        break;
      }
      pagesLoaded += 1;
      recordingsProcessed += data.length;

      // Warm all small card media for this batch: thumbnails, sprites, and
      // animated (.webp / .mp4_preview) previews. Everything routes through
      // preloadRecordingMedia → the same single paced queue used by the page
      // warmer and hover preloads, which dedups URLs per session and keeps the
      // host semaphores + concurrency caps — so warming the hot set can never
      // burst any upstream. Real video previews are deliberately excluded
      // (multi-MB) — those stay on-demand at hover time.
      for (const rec of data) {
        if (rec.sprite_url) spritesLoaded += 1;
        if (rec.thumbnail_url) thumbnailsLoaded += 1;
        if (rec.preview_url) previewsLoaded += 1;
      }
      preloadRecordingMedia(data, {});
    }

    updateProgress({
      pagesLoaded,
      totalPages: Math.max(pagesLoaded, MAX_PAGES),
      recordingsProcessed,
      totalRecordings: Math.max(recordingsProcessed, MAX_PAGES * PAGE_SIZE),
      thumbnailsLoaded,
      spritesLoaded,
      previewsLoaded,
    });

    currentPage += batchSize;
    if (currentPage <= MAX_PAGES && !warmupAbort) {
      // Yield to the browser between batches so we never block user input
      // (scrolling, typing, hover events). Falls back to 200ms on browsers
      // without requestIdleCallback (old Safari).
      await yieldToIdle();
    }
  }

  // Reclaim space if we overshot the IDB budget during warming.
  await evictIfNeeded();

  try {
    localStorage.setItem(WARM_MARKER, String(Date.now()));
  } catch {
    /* ignore */
  }

  if (!warmupAbort) updateProgress({ phase: "done" });
}

/**
 * Reset the warm marker so the next call to startCatalogWarmup will re-warm
 * regardless of the re-warm interval. Useful for testing and admin tooling.
 */
export function resetWarmMarker(): void {
  try {
    localStorage.removeItem(WARM_MARKER);
  } catch { /* ignore */ }
}
