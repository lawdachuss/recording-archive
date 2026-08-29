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
import { cacheImage } from "@/lib/image-cache";
import { isConnectionConstrained } from "@/lib/connection";

// Hosts that block server/datacenter IPs entirely (SSL handshake fails,
// empty bodies, or multi-minute timeouts). Catbox is reachable from
// residential browsers but unreliable enough to skip — the sprite IS
// the preview for these recordings.
const UNREACHABLE_PREVIEW_HOSTS = [
  "catbox.moe",
  "files.catbox.moe",
  "litter.catbox.moe",
  "files.litterbox.catbox.moe",
];

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
// All media now comes through /api/media (same-origin proxy) which handles
// upstream rate limiting server-side. We removed the per-origin client-side
// throttling that was limiting us to 1 request/60ms — the browser's built-in
// connection limits (6-8 per origin for HTTP/1.1, more for HTTP/2) are
// sufficient safety.
const warmed = new Set<string>();
// Track when a URL last failed. Permanently broken URLs (404s, DNS failures,
// CORS) won't recover, but transient failures (a momentarily slow/unreachable
// host) should be retried after a cooldown rather than blacklisted for the
// entire session. The cooldown bounds retry storms.
const failedAt = new Map<string, number>();
const FAILED_RETRY_COOLDOWN_MS = 5 * 60_000; // retry a failed URL after 5 min
const MAX_ACTIVE = 12;

const queue: Array<{ url: string; img: HTMLImageElement }> = [];
let activeCount = 0;
let pumpTimer: number | null = null;

function getConcurrency(): number {
  if (isConnectionConstrained()) return 2; // Only 2 concurrent loads on slow connections
  return MAX_ACTIVE;
}

function startRequest(url: string, img: HTMLImageElement) {
  activeCount++;

  img.onload = () => {
    activeCount--;
    // Persist to IDB blob cache for instant repeat-visit loading.
    // Sprites and thumbnails get higher priority (3) so they're evicted last.
    cacheImage(url, 3); // fire-and-forget
    pump();
  };
  img.onerror = () => {
    activeCount--;
    const now = Date.now();
    const last = failedAt.get(url) ?? 0;
    if (now - last < FAILED_RETRY_COOLDOWN_MS) {
      // Failed recently — keep in the warmed set to avoid a retry storm.
    } else {
      // Record the failure and allow exactly one retry from a later preload
      // pass (e.g. hover preload after the catalog warmer missed it). Once the
      // cooldown elapses, preloadImage() will permit another attempt.
      failedAt.set(url, now);
      warmed.delete(url);
    }
    pump();
  };
  img.src = url;
}

function pump() {
  if (pumpTimer !== null) {
    window.clearTimeout(pumpTimer);
    pumpTimer = null;
  }
  const maxActive = getConcurrency();
  while (queue.length > 0 && activeCount < maxActive) {
    const item = queue.shift()!;
    startRequest(item.url, item.img);
  }
  // Re-pump after a short delay in case active slots freed up
  if (queue.length > 0 && pumpTimer === null) {
    pumpTimer = window.setTimeout(pump, 50);
  }
}

/**
 * Warm a single image into the HTTP cache + service worker cache.
 * Idempotent per URL for the lifetime of the page.
 */
export function preloadImage(url: string | null | undefined): void {
  if (!url) return;
  if (isConnectionConstrained()) return;
  if (warmed.has(url)) {
    const last = failedAt.get(url) ?? 0;
    if (last && Date.now() - last >= FAILED_RETRY_COOLDOWN_MS) {
      // Cooldown elapsed since the last failure — permit a fresh attempt.
      failedAt.delete(url);
      warmed.delete(url);
    } else {
      // Already enqueued (e.g. by the idle full-catalog warmer) but not
      // started yet — a hot request (viewport preload right before a hover)
      // should not wait behind the whole catalog. Move it to the head.
      const idx = queue.findIndex((item) => item.url === url);
      if (idx > 0) {
        const [item] = queue.splice(idx, 1);
        queue.unshift(item);
        pump();
      }
      return;
    }
  }
  warmed.add(url);
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.fetchPriority = "low";
  img.decoding = "async";
  queue.push({ url, img });
  pump();
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