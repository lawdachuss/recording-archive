/**
 * catalog-warmer.ts — continuous, connection-aware catalog media preloader.
 *
 * After first paint, warms thumbnails → sprites → previews for the catalog so
 * that scrolling and repeat visits are instant. It now routes every preload
 * through preload-sprite's single paced queue (preloadImage), so there is
 * exactly one coordination point for outbound media requests — no second,
 * uncoordinated queue competing with the grid for bandwidth.
 *
 * - The first ~16 thumbnails are marked immediate + high priority so the first
 *   screen paints as fast as the (often slow, direct-to-browser) host allows.
 * - Remaining thumbnails, then sprites, then previews, are enqueued in priority
 *   order; preload-sprite paces them per connection quality.
 * - Pixhost thumbnails are written to the IDB blob cache (via cacheImage inside
 *   preload-sprite) so repeat visits are instant; catbox thumbnails (which
 *   block server-side hotlinking) are warmed in the browser HTTP cache only.
 */

import { listRecordings } from "@workspace/api-client-react";
import { proxyUrl, proxySpriteUrl } from "@/lib/proxy-url";
import { preloadImage, isReachablePreviewUrl } from "@/lib/preload-sprite";
import { preloadPreviewMedia } from "@/lib/preload-preview";
import { evictIfNeeded } from "@/lib/image-cache";
import { isConnectionConstrained } from "@/lib/connection";

// ─── Config ────────────────────────────────────────────────────────────────
const WARM_MARKER = "catalog.warmUntil";
const WARM_REINTERVAL_MS = 6 * 60 * 60 * 1000; // re-warm at most every 6h
const WARM_DELAY_MS = 1_500; // wait for first paint before warming
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // ~1000 recordings; covers the catalog's hot set
const PARALLEL_FETCHES = 3; // fetch 3 pages concurrently
const FIRST_SCREEN_THUMBS = 16; // immediate + high priority

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
  let firstScreenRemaining = FIRST_SCREEN_THUMBS;

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
        // current page. We only warm hover media (sprites + previews) that
        // isn't on screen yet — that's pure prefetch with no competition.
        if (rec.sprite_url && isReachablePreviewUrl(rec.sprite_url)) {
          // Sprites get priority 2. Skip throttled hosts (catbox) so their
          // limited connection budget is reserved for the visible thumbnails
          // the user is actually looking at — hover sprites can load on demand.
          preloadImage(proxySpriteUrl(rec.sprite_url), { priority: 2 });
          spritesLoaded += 1;
        }
        if (rec.preview_url && isReachablePreviewUrl(rec.preview_url)) {
          // Previews are preloaded eagerly via <link rel=preload>; they are
          // large, so they don't go through the IDB queue (priority 1 = evict).
          preloadPreviewMedia(proxyUrl(rec.preview_url));
          previewsLoaded += 1;
        }
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
  evictIfNeeded();

  try {
    localStorage.setItem(WARM_MARKER, String(Date.now()));
  } catch {
    /* ignore */
  }

  if (!warmupAbort) updateProgress({ phase: "done" });
}
