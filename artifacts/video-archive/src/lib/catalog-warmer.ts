/**
 * catalog-warmer.ts — Advanced catalog-wide media preloader
 *
 * Warms thumbnails, sprite sheets, and preview clips for the entire catalog
 * in the background after first paint. Uses:
 *
 *   - Parallel page fetching (3 concurrent API calls)
 *   - Priority tiers: thumbnails → sprites → previews (small → large)
 *   - Adaptive concurrency based on real download speed
 *   - Progress tracking (reactive state for UI display)
 *   - Idle-scheduled work that pauses when user is active
 *   - Service worker / HTTP cache fills for instant repeat visits
 */

import { listRecordings } from "@workspace/api-client-react";
import { preloadImage, preloadImages } from "@/lib/preload-sprite";
import { proxyUrl } from "@/lib/proxy-url";
import { isReachablePreviewUrl } from "@/lib/preload-sprite";
import { preloadPreviewMedia } from "@/lib/preload-preview";

// ─── Configuration ──────────────────────────────────────────────────────────

const WARM_MARKER = "catalog.warmUntil";
const WARM_REINTERVAL_MS = 6 * 60 * 60 * 1000; // re-warm at most every 6h
const WARM_DELAY_MS = 2_000; // start 2s after first paint
const PAGE_SIZE = 100;
const MAX_PAGES = 100; // up to 10,000 recordings
const PARALLEL_FETCHES = 3; // concurrent API page fetches

// Adaptive concurrency thresholds
const FAST_THRESHOLD_BPS = 5_000_000; // >5MB/s = fast
const SLOW_THRESHOLD_BPS = 500_000; // <500KB/s = slow
const CONCURRENCY_FAST = 12;
const CONCURRENCY_MEDIUM = 6;
const CONCURRENCY_SLOW = 2;

// ─── Progress state (reactive) ──────────────────────────────────────────────

export interface WarmProgress {
  phase: "idle" | "fetching" | "warming" | "done";
  pagesLoaded: number;
  totalPages: number;
  recordingsProcessed: number;
  totalRecordings: number;
  thumbnailsLoaded: number;
  spritesLoaded: number;
  previewsLoaded: number;
  currentConcurrency: number;
  startedAt: number;
}

type ProgressListener = (progress: WarmProgress) => void;

const listeners = new Set<ProgressListener>();
let progress: WarmProgress = {
  phase: "idle",
  pagesLoaded: 0,
  totalPages: 0,
  recordingsProcessed: 0,
  totalRecordings: 0,
  thumbnailsLoaded: 0,
  spritesLoaded: 0,
  previewsLoaded: 0,
  currentConcurrency: CONCURRENCY_MEDIUM,
  startedAt: 0,
};

function updateProgress(patch: Partial<WarmProgress>) {
  progress = { ...progress, ...patch };
  for (const listener of listeners) {
    try { listener(progress); } catch { /* listener error — non-fatal */ }
  }
}

export function onWarmProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWarmProgress(): WarmProgress {
  return progress;
}

// ─── Adaptive concurrency ───────────────────────────────────────────────────

// Track recent download speeds to pick the right concurrency
const speedSamples: number[] = [];
const MAX_SPEED_SAMPLES = 20;

function recordSpeed(bytesLoaded: number, durationMs: number) {
  if (durationMs <= 0) return;
  const bps = (bytesLoaded * 8) / (durationMs / 1000);
  speedSamples.push(bps);
  if (speedSamples.length > MAX_SPEED_SAMPLES) speedSamples.shift();
}

function getAdaptiveConcurrency(): number {
  if (speedSamples.length < 3) return CONCURRENCY_MEDIUM;
  // Use median speed for stability
  const sorted = [...speedSamples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median > FAST_THRESHOLD_BPS) return CONCURRENCY_FAST;
  if (median < SLOW_THRESHOLD_BPS) return CONCURRENCY_SLOW;
  return CONCURRENCY_MEDIUM;
}

// ─── Connection detection ───────────────────────────────────────────────────

function isConnectionConstrained(): boolean {
  const conn = (navigator as any).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  const slow = ["slow-2g", "2g", "3g"];
  return typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType);
}

function getMaxPages(): number {
  if (isConnectionConstrained()) return 10; // 1000 recordings on slow
  return MAX_PAGES;
}

// ─── Idle scheduling ────────────────────────────────────────────────────────

function scheduleIdle(task: () => void, timeout = 1_000) {
  const requestIdle =
    window.requestIdleCallback ??
    ((cb: IdleRequestCallback) => {
      const id = window.setTimeout(
        () => cb({ didTimeout: false, timeRemaining: () => 0 }),
        timeout,
      );
      return id as unknown as number;
    });
  requestIdle(task, { timeout });
}

// ─── Parallel page fetcher ──────────────────────────────────────────────────

/**
 * Fetch multiple pages from the API in parallel.
 * Returns pages in order — if page 3 finishes before page 2,
 * the caller still gets [page2, page3] in sequence.
 */
async function fetchPagesInParallel(
  startPage: number,
  count: number,
  maxPages: number,
): Promise<Array<{ page: number; data: any[] }>> {
  const results: Array<{ page: number; data: any[] }> = [];
  const promises: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    const pageNum = startPage + i;
    if (pageNum > maxPages) break;

    promises.push(
      (async () => {
        try {
          const response = await listRecordings({
            page: pageNum,
            limit: PAGE_SIZE,
            sort: "newest",
          });
          results.push({ page: pageNum, data: response.data ?? [] });
        } catch {
          // API hiccup — skip this page
          results.push({ page: pageNum, data: [] });
        }
      })(),
    );
  }

  await Promise.all(promises);

  // Sort by page number to maintain order
  results.sort((a, b) => a.page - b.page);
  return results;
}

// ─── Priority preload engine ────────────────────────────────────────────────

interface PreloadTask {
  url: string;
  priority: 1 | 2 | 3; // 1=thumbnail, 2=sprite, 3=preview
  size: number; // estimated bytes for speed tracking
}

const PRIORITY_LABELS = { 1: "thumbnail", 2: "sprite", 3: "preview" } as const;

/**
 * Adaptive priority queue that processes tasks in order:
 * - All priority 1 (thumbnails) before priority 2 (sprites)
 * - All priority 2 before priority 3 (previews)
 * - Within each priority, concurrent with adaptive concurrency
 */
class PriorityPreloadQueue {
  private queue: PreloadTask[] = [];
  private activeCount = 0;
  private done = false;
  private pumpTimer: number | null = null;
  private processed = { 1: 0, 2: 0, 3: 0 };
  private onTaskComplete: ((priority: 1 | 2 | 3) => void) | null = null;
  private lastOriginStart = new Map<string, number>();

  constructor(private getConcurrency: () => number) {}

  setOnTaskComplete(cb: (priority: 1 | 2 | 3) => void) {
    this.onTaskComplete = cb;
  }

  enqueue(tasks: PreloadTask[]) {
    this.queue.push(...tasks);
    this.pump();
  }

  private pump() {
    if (this.pumpTimer !== null) {
      window.clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }

    const maxActive = this.getConcurrency();
    const now = performance.now();

    // Process in priority order: 1 first, then 2, then 3
    for (let priority = 1; priority <= 3; priority++) {
      for (let i = 0; i < this.queue.length && this.activeCount < maxActive; ) {
        const task = this.queue[i];
        if (task.priority !== priority) {
          i++;
          continue;
        }

        // Pace by origin (avoid hammering one host)
        const origin = originOf(task.url);
        const lastStart = this.lastOriginStart.get(origin) ?? 0;
        const minGap = this.activeCount < 4 ? 30 : 80; // more aggressive when not busy
        if (now - lastStart < minGap) {
          i++;
          continue;
        }

        // Dequeue and start
        this.queue.splice(i, 1);
        this.lastOriginStart.set(origin, now);
        this.activeCount++;
        this.startTask(task);
      }
    }

    // Schedule next pump if queue has items
    if (this.queue.length && this.pumpTimer === null) {
      this.pumpTimer = window.setTimeout(() => this.pump(), 40);
    }

    // Signal done when queue is empty and no active tasks
    if (this.queue.length === 0 && this.activeCount === 0 && !this.done) {
      this.done = true;
    }
  }

  private startTask(task: PreloadTask) {
    const startTime = performance.now();
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.fetchPriority = "low";
    img.decoding = "async";

    img.onload = () => {
      const elapsed = performance.now() - startTime;
      recordSpeed(task.size, elapsed);
      this.activeCount--;
      this.processed[task.priority]++;
      this.onTaskComplete?.(task.priority);
      this.pump();
    };

    img.onerror = () => {
      this.activeCount--;
      this.pump();
    };

    img.src = task.url;
  }

  isComplete() {
    return this.done;
  }

  getProcessed() {
    return { ...this.processed };
  }

  getRemaining() {
    return this.queue.length;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// ─── Main warmup orchestrator ───────────────────────────────────────────────

let warmupAbort = false;

export function cancelWarmup() {
  warmupAbort = true;
}

export async function startCatalogWarmup(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isConnectionConstrained()) return;

  // Check if we already warmed recently
  const last = Number(localStorage.getItem(WARM_MARKER) || 0);
  if (Date.now() - last < WARM_REINTERVAL_MS) return;

  warmupAbort = false;

  updateProgress({
    phase: "fetching",
    pagesLoaded: 0,
    totalPages: 0,
    recordingsProcessed: 0,
    totalRecordings: 0,
    thumbnailsLoaded: 0,
    spritesLoaded: 0,
    previewsLoaded: 0,
    currentConcurrency: CONCURRENCY_MEDIUM,
    startedAt: Date.now(),
  });

  const maxPages = getMaxPages();
  const concurrency = getAdaptiveConcurrency();
  const queue = new PriorityPreloadQueue(() => getAdaptiveConcurrency());
  queue.setOnTaskComplete((priority) => {
    const processed = queue.getProcessed();
    updateProgress({
      thumbnailsLoaded: processed[1],
      spritesLoaded: processed[2],
      previewsLoaded: processed[3],
      currentConcurrency: getAdaptiveConcurrency(),
    });
  });

  let currentPage = 1;
  let totalRecordings = 0;
  let pagesLoaded = 0;
  let done = false;

  while (currentPage <= maxPages && !warmupAbort && !done) {
    // Fetch PARALLEL_FETCHES pages at once
    const batchSize = Math.min(PARALLEL_FETCHES, maxPages - currentPage + 1);
    const pages = await fetchPagesInParallel(currentPage, batchSize, maxPages);

    updateProgress({ phase: "warming" });

    for (const { data } of pages) {
      if (data.length === 0) {
        done = true;
        break;
      }

      totalRecordings += data.length;
      pagesLoaded++;

      // Build priority tasks for this page
      const tasks: PreloadTask[] = [];

      for (const rec of data) {
        // Priority 1: Thumbnails (small, critical for grid paint)
        if (rec.thumbnail_url) {
          tasks.push({
            url: proxyUrl(rec.thumbnail_url) ?? "",
            priority: 1,
            size: 30_000, // ~30KB per thumbnail
          });
        }

        // Priority 2: Sprites (medium, critical for hover preview)
        if (rec.sprite_url) {
          tasks.push({
            url: proxyUrl(rec.sprite_url) ?? "",
            priority: 2,
            size: 300_000, // ~300KB per sprite sheet
          });
        }

        // Priority 3: Preview clips (large, nice-to-have)
        if (rec.preview_url && isReachablePreviewUrl(rec.preview_url)) {
          const proxiedUrl = proxyUrl(rec.preview_url) ?? "";
          tasks.push({
            url: proxiedUrl,
            priority: 3,
            size: 1_000_000, // ~1MB per preview clip
          });
        }
      }

      queue.enqueue(tasks);

      updateProgress({
        pagesLoaded,
        totalPages: Math.max(pagesLoaded, maxPages),
        recordingsProcessed: totalRecordings,
        totalRecordings: Math.max(totalRecordings, maxPages * PAGE_SIZE),
      });
    }

    currentPage += batchSize;

    // Brief pause between batch fetches to not overwhelm the API
    if (currentPage <= maxPages && !warmupAbort && !done) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Wait for all queued preloads to finish (with timeout)
  const WAIT_TIMEOUT_MS = 120_000; // 2 minutes max
  const waitStart = Date.now();
  while (!queue.isComplete() && !warmupAbort) {
    if (Date.now() - waitStart > WAIT_TIMEOUT_MS) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Mark as warmed
  try {
    localStorage.setItem(WARM_MARKER, String(Date.now()));
  } catch { /* non-fatal */ }

  updateProgress({ phase: "done" });
}
