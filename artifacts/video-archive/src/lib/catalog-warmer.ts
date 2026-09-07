/**
 * catalog-warmer.ts — bounded, connection-aware catalog sprite preloader.
 *
 * After first paint, warms hover sprites for the catalog's hot set (the first
 * couple of pages) so scrolling and repeat visits are instant. Deliberately
 * BOUNDED — the old version warmed ~1000 sprites AND eagerly downloaded
 * ~1000 full preview videos a few seconds after page load, saturating the
 * connection and slowing the grid for minutes.
 *
 * - Only sprites are warmed. Preview clips/videos are multi-MB files; warming
 *   thousands of them starved the visible thumbnails. Previews load on
 *   demand: cards near the viewport preload their own preview via
 *   useHoverPreview, and the global cap in preload-preview.ts bounds those
 *   speculative downloads to a few concurrent at a time.
 * - Only MAX_PAGES × PAGE_SIZE recordings are warmed (100) — the catalog's
 *   first page, i.e. the hot set. Deeper recordings warm on demand when
 *   scrolled to.
 * - The warmup also does NOT start right after page load: App schedules it
 *   ~20s in via idle callback, so it never competes with first paint or the
 *   user's first few scrolls.
 * - Everything routes through preload-sprite's single paced queue, so outbound
 *   media requests have exactly one coordination point.
 *
 * Thumbnails are intentionally NOT warmed here: the grid's <img> fetches
 * visible thumbnails itself, and OptimizedImage persists them to the IDB blob
 * cache on load. Preloading them again would just multiply requests.
 */

import { listRecordings } from "@workspace/api-client-react";
import { proxySpriteUrl } from "@/lib/proxy-url";
import { preloadImage, isReachablePreviewUrl } from "@/lib/preload-sprite";
import { evictIfNeeded } from "@/lib/image-cache";
import { isConnectionConstrained } from "@/lib/connection";

// ─── Config ────────────────────────────────────────────────────────────────
const WARM_MARKER = "catalog.warmUntil";
const WARM_REINTERVAL_MS = 6 * 60 * 60 * 1000; // re-warm at most every 6h
const WARM_DELAY_MS = 1_500; // wait for first paint before warming
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

  // Wait for first paint / idle before hammering the network
  await new Promise((r) => setTimeout(r, WARM_DELAY_MS));
  if (warmupAbort) return;

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

      for (const rec of data) {
        // NOTE: thumbnails are intentionally NOT preloaded here. The grid's
        // <img> already fetches each visible thumbnail, and OptimizedImage
        // persists it to the IDB blob cache on load. Preloading thumbnails a
        // second/third time would just multiply slow catbox requests on the
        // current page. We only warm hover sprites that aren't on screen yet
        // — that's pure prefetch with no competition.
        if (rec.sprite_url && isReachablePreviewUrl(rec.sprite_url)) {
          // Sprites get priority 2. Skip throttled hosts (catbox) so their
          // limited connection budget is reserved for the visible thumbnails
          // the user is actually looking at — hover sprites can load on demand.
          preloadImage(proxySpriteUrl(rec.sprite_url), { priority: 2 });
          spritesLoaded += 1;
        }
        // Previews are deliberately NOT warmed here — they are multi-MB files
        // and warming hundreds of them saturated the connection. Near-viewport
        // cards preload their own preview via useHoverPreview (capped to a few
        // concurrent downloads by preload-preview.ts).
      }
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
      // Small gap so we don't fetch the whole catalog back-to-back.
      await new Promise((r) => setTimeout(r, 200));
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
