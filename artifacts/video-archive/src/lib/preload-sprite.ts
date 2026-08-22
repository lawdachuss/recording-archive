/**
 * preload-sprite.ts — fast card-media preloading.
 *
 * Sprites are the primary hover preview for most of the catalog (pixhost),
 * thumbnails are what makes the grid paint, and a few previews come from
 * reachable hosts. All three need to be in the browser HTTP cache / service
 * worker cache BEFORE the pointer reaches the card. This module provides:
 *   - preloadImage(url): one-off warm of a single image (dedup'd).
 *   - preloadImages(urls): batch warm (items are dedup'd against the module).
 *   - preloadRecordingAssets(recs): warm sprite + thumbnail + reachable
 *     preview for a list of recordings in one call.
 *
 * Requests are made with new Image() so the request has destination "image"
 * and the service worker caches readable OK responses for repeat visits.
 * Preloads are skipped entirely on saveData / slow connections.
 *
 * All starts are funneled through a single global, per-origin paced queue so
 * a page-full of sprites + thumbnails (and the idle full-catalog warmer) can
 * never dump a request burst on one host. pixhost in particular rate-limits
 * (429) and drops HTTP/2 streams when hit with dozens of parallel requests.
 */

import { preloadPreviewMedia } from "@/lib/preload-preview";
import { proxyUrl } from "@/lib/proxy-url";

// Hosts known to be unreachable from the SERVER (datacenter IPs) — but they
// work fine from the browser with referrerPolicy="no-referrer". We proxy
// them through /api/media so the browser never connects to catbox directly.
// Keep this list empty unless a host truly blocks browser requests too.
const UNREACHABLE_PREVIEW_HOSTS: string[] = [];

export function isReachablePreviewUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return !UNREACHABLE_PREVIEW_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return true;
  }
}

// ─── Global paced preload queue ─────────────────────────────────────────
// One queue across every preload caller (page effects, warmSpriteCatalog,
// app background warmup) so the browser never opens unbounded parallel
// connections to a single media host. Since media now comes from our own
// origin (/api/media, which queues upstream fetches server-side), the pacing
// here is a lighter safety net than before.
const warmed = new Set<string>();
const MAX_ACTIVE = 8;
const ORIGIN_INTERVAL_MS = 60;

const queue: Array<{ url: string; img: HTMLImageElement }> = [];
let activeCount = 0;
let pumpTimer: number | null = null;
const lastStartByOrigin = new Map<string, number>();

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function isConnectionConstrained(): boolean {
  const conn = (navigator as any).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  const slow = ["slow-2g", "2g", "3g"];
  return typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType);
}

function getConcurrency(): number {
  if (isConnectionConstrained()) return 2; // Only 2 concurrent loads on slow connections
  return MAX_ACTIVE;
}

function scheduleIdle(task: () => void, timeout = 1_500) {
  const requestIdle =
    window.requestIdleCallback ??
    ((cb: IdleRequestCallback) => {
      const id = window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), timeout);
      return id as unknown as number;
    });
  requestIdle(task, { timeout });
}

function startRequest(url: string, img: HTMLImageElement) {
  lastStartByOrigin.set(originOf(url), performance.now());
  activeCount++;
  img.onload = () => {
    activeCount--;
    pump();
  };
  img.onerror = () => {
    activeCount--;
    // The URL failed this session — drop it from the dedup set so a later,
    // narrower preload call (e.g. just before a hover) gets one real retry.
    warmed.delete(url);
    pump();
  };
  img.src = url;
}

function pump() {
  if (pumpTimer !== null) {
    window.clearTimeout(pumpTimer);
    pumpTimer = null;
  }
  const now = performance.now();
  const maxActive = getConcurrency();
  for (let i = 0; i < queue.length && activeCount < maxActive; ) {
    const item = queue[i];
    const last = lastStartByOrigin.get(originOf(item.url)) ?? 0;
    if (now - last < ORIGIN_INTERVAL_MS) {
      i++;
      continue;
    }
    queue.splice(i, 1);
    startRequest(item.url, item.img);
  }
  if (queue.length && pumpTimer === null) {
    pumpTimer = window.setTimeout(pump, ORIGIN_INTERVAL_MS);
  }
}

/**
 * Warm a single image into the HTTP cache + service worker cache.
 * Idempotent per URL for the lifetime of the page.
 */
export function preloadImage(url: string | null | undefined): void {
  if (!url) return;
  if (isConnectionConstrained()) return;
  if (!warmed.has(url)) {
    warmed.add(url);
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.fetchPriority = "low";
    img.decoding = "async";
    queue.push({ url, img });
    pump();
    return;
  }
  // Already enqueued (e.g. by the idle full-catalog warmer) but not started
  // yet — a hot request (viewport preload right before a hover) should not
  // wait behind the whole catalog. Move it to the head of the queue.
  const idx = queue.findIndex((item) => item.url === url);
  if (idx > 0) {
    const [item] = queue.splice(idx, 1);
    queue.unshift(item);
    pump();
  }
}

/**
 * Batch-warm many images. Items are dedup'd against already-warmed / in-queue
 * URLs; actual starts are paced by the global queue (see above). Always
 * returns immediately.
 */
export function preloadImages(
  urls: (string | null | undefined)[],
): void {
  if (typeof window === "undefined") return;
  for (const url of urls) preloadImage(url);
}

/**
 * Warm all hover media for a list of recordings: thumbnails (grid paint)
 * first, then sprites (hover preview), and previews eagerly. Previews use
 * <link rel="preload" as="image"> for instant HTTP/2 priority so they're
 * cached before the user hovers.
 */
export function preloadRecordingAssets(
  recs: Array<{ sprite_url?: string | null; thumbnail_url?: string | null; preview_url?: string | null }>,
): void {
  const thumbs: (string | null | undefined)[] = [];
  const sprites: (string | null | undefined)[] = [];
  const previews: (string | null | undefined)[] = [];
  for (const rec of recs) {
    if (rec.thumbnail_url) thumbs.push(proxyUrl(rec.thumbnail_url));
    if (rec.sprite_url) sprites.push(proxyUrl(rec.sprite_url));
    if (rec.preview_url && isReachablePreviewUrl(rec.preview_url)) {
      previews.push(proxyUrl(rec.preview_url));
    }
  }
  preloadImages([...thumbs, ...sprites]);
  // Previews are preloaded eagerly (not deferred to idle) because
  // <link rel="preload"> is lightweight and the browser handles prioritization.
  if (previews.length) {
    previews.forEach((p) => preloadPreviewMedia(p));
  }
}

/**
 * Warm only the hover media (sprites + reachable previews) for a list of
 * recordings. Used for page-level preloads where the DOM <img> tags already
 * fetch thumbnails themselves — preloading them again would double the
 * requests and compete with grid paint.
 */
export function preloadRecordingSprites(
  recs: Array<{ sprite_url?: string | null; preview_url?: string | null }>,
): void {
  const sprites: (string | null | undefined)[] = [];
  const previews: (string | null | undefined)[] = [];
  for (const rec of recs) {
    if (rec.sprite_url) sprites.push(proxyUrl(rec.sprite_url));
    if (rec.preview_url && isReachablePreviewUrl(rec.preview_url)) {
      previews.push(proxyUrl(rec.preview_url));
    }
  }
  preloadImages(sprites);
  // Eager preload — <link rel="preload"> is lightweight.
  if (previews.length) {
    previews.forEach((p) => preloadPreviewMedia(p));
  }
}

/** @deprecated alias — use preloadImage */
export const preloadSprite = preloadImage;
/** @deprecated alias — use preloadImages */
export const preloadSprites = preloadImages;