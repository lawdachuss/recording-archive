/**
 * preload-preview.ts — shared preview media preloading.
 *
 * Warms the browser HTTP cache (and, via the service worker, the Cache API)
 * for preview clips and images BEFORE they are needed, so hover playback and
 * next-page rendering start instantly. Preload elements are created detached;
 * the browser still fetches their source and the service worker caches media
 * responses for repeat visits.
 *
 * Every speculative preview download is capped to MAX_CONCURRENT_PRELOADS
 * simultaneous loads. Preview files are multi-MB; without a cap, page-level
 * warmers + viewport preloads fired dozens of full downloads at once and
 * starved the grid's visible thumbnails. Excess requests wait FIFO for a slot.
 */

import { cacheImage, isCached } from "@/lib/image-cache";
import { isConnectionConstrained } from "@/lib/connection";

const preloadCache = new Map<string, HTMLVideoElement | HTMLImageElement | true>();

// Maximum number of detached video elements to keep alive.
// Each preview video holds a reference to the decoded media in memory.
const MAX_VIDEO_ELEMENTS = 20;

// Cap on detached <img> preview elements kept alive for the page lifetime.
// Without this, every newly-hovered .webp preview adds a permanently-pinned
// <img> to memory and the map grows unboundedly over a long session.
const MAX_IMAGE_ELEMENTS = 40;

// Separate queue tracking video URLs for O(1) eviction (FIFO order).
const videoKeys: string[] = [];
// FIFO tracker for <img> entries so the animated-image subset stays bounded.
const imageKeys: string[] = [];

// ─── Global concurrency cap for speculative preview loads ─────────────────
// 6 parallel preview downloads: with previews now prefetched at page load
// (use-preload-recordings), a higher cap fills the IDB/HTTP cache much
// faster while still leaving connection headroom for the visible grid.
const MAX_CONCURRENT_PRELOADS = 6;
let activePreloads = 0;
const preloadWaiters: Array<() => void> = [];

/** Resolve a download slot once one frees up. Returns a release function. */
function acquirePreloadSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryRun = () => {
      if (activePreloads >= MAX_CONCURRENT_PRELOADS) {
        preloadWaiters.push(tryRun);
        return;
      }
      activePreloads++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activePreloads--;
        const next = preloadWaiters.shift();
        if (next) next();
      });
    };
    tryRun();
  });
}

/**
 * Release a preload slot once the resource has loaded (or failed/stalled).
 * A 15s timeout keeps a stuck host (catbox can hold connections open) from
 * holding a slot forever and blocking the queue behind it.
 */
function releaseOnSettle(el: HTMLVideoElement | HTMLImageElement, release: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    release();
  };
  // 8s, down from 15s: a throttled host (catbox answers ~16KB/s) must not
  // hold a queue slot for a quarter of a minute while fast proxied previews
  // wait behind it.
  const timer = window.setTimeout(finish, 8_000);
  el.addEventListener("loadeddata", finish, { once: true });
  el.addEventListener("load", finish, { once: true });
  el.addEventListener("error", finish, { once: true });
  el.addEventListener("abort", finish, { once: true });
}
/**
 * Unwrap a media-proxy URL (`/api/media?url=<encoded>`) to extract the
 * real upstream URL. Extension-based type detection needs the original
 * URL, not the proxy wrapper.
 */
function unwrapProxyUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith("/api/media")) {
      const inner = parsed.searchParams.get("url");
      if (inner) return inner;
    }
    // wsrv.nl re-encodes media under its own origin (`/?url=<encoded>`).
    if (parsed.hostname.endsWith("wsrv.nl")) {
      const inner = parsed.searchParams.get("url");
      if (inner) return inner;
    }
  } catch {
    // Not parseable — fall through to the raw string.
  }
  return url;
}

/**
 * Extract the file extension from a URL, using pathname (not the full URL)
 * so query params like `?token=abc` don't break detection.
 * Returns lowercase extension with dot, e.g. ".webp", or "" if none.
 */
function getExt(url: string): string {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const dot = pathname.lastIndexOf(".");
    return dot >= 0 ? pathname.slice(dot).toLowerCase() : "";
  } catch {
    // Fall back to string search
    const q = url.split("?")[0];
    const dot = q.lastIndexOf(".");
    return dot >= 0 ? q.slice(dot).toLowerCase() : "";
  }
}

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const ext = getExt(unwrapProxyUrl(url));
  return ext === ".mp4" || ext === ".webm" || ext === ".mov" || url.includes(".m3u8");
}

export function isAnimatedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const unwrapped = unwrapProxyUrl(url) ?? url;
  const ext = getExt(unwrapped);
  // `.webp` is a genuine animated WebP. `.mp4_preview` is a misleadingly-named
  // file that is actually animated WEBP content (observed on catbox mirrors).
  return ext === ".webp" || ext === ".mp4_preview" || /\.mp4_preview$/i.test(unwrapped);
}

/**
 * A preview URL is treated as a video candidate when it has a real video
 * extension OR a .webp extension. Historically most .webp previews in the DB
 * are actually MP4 clips served with a misleading .webp extension
 * (assets.upns.net / asset.seekstreaming.info). Genuine animated WebP still
 * works because the UI renders the video first and falls back to <img> on
 * error.
 */
export function isVideoCandidate(url: string | null | undefined): boolean {
  return isVideoUrl(url) || isAnimatedImageUrl(url);
}

/**
 * Evict the oldest video element from the preload cache to prevent memory leaks.
 * Detached <video> elements hold decoded media frames in memory.
 */
function evictOldestVideo(): void {
  const oldestKey = videoKeys.shift();
  if (!oldestKey) return;
  const el = preloadCache.get(oldestKey);
  if (el instanceof HTMLVideoElement) {
    el.src = ""; // Release media resource
    el.load();   // Force cleanup
  }
  preloadCache.delete(oldestKey);
}

/**
 * Evict the oldest detached <img> from the preload cache to bound memory.
 */
function evictOldestImage(): void {
  const oldestKey = imageKeys.shift();
  if (!oldestKey) return;
  const el = preloadCache.get(oldestKey);
  if (el instanceof HTMLImageElement) {
    el.src = ""; // Release the decoded bitmap
  }
  preloadCache.delete(oldestKey);
}

export function preloadVideo(url: string): void {
  if (preloadCache.has(url)) return;
  // Don't preload on slow/constrained connections — the bandwidth is needed
  // for the actual page content, not speculative hover previews.
  if (isConnectionConstrained()) return;

  // Already persisted to the IDB blob cache (a previous visit / hover warmed
  // it) — skip the full re-download entirely. Multi-MB previews must not be
  // re-fetched speculatively on every page load just to warm a cache that
  // already has them. Checked BEFORE taking a queue slot so cached URLs
  // never occupy one of the 3 concurrent downloads.
  void isCached(url).then((cached) => {
    if (cached) return;
    if (preloadCache.has(url)) return; // someone warmed it while we checked

    // Enforce memory limit — evict oldest video if we're at capacity
    if (videoKeys.length >= MAX_VIDEO_ELEMENTS) {
      evictOldestVideo();
    }

    // Cap concurrent speculative downloads (see global gate above) so a
    // page-full of previews can't saturate the connection.
    void acquirePreloadSlot().then((release) => {
      // Re-check: another caller may have warmed this URL while we waited.
      if (preloadCache.has(url)) {
        release();
        return;
      }
      const v = document.createElement("video");
      v.muted = true;
      // Full download ("auto"), NOT metadata. preloadVideo is only called for
      // cards already near the viewport (useHoverPreview's IO, gated by the
      // global 3-concurrent cap), so fetching the full preview now makes the
      // hover instant AND lets onloadeddata persist the whole file to the IDB
      // blob cache for zero-network repeat hovers. Metadata-only left the actual
      // bytes to re-fetch on every hover.
      v.preload = "auto";
      (v as HTMLVideoElement & { referrerPolicy?: string }).referrerPolicy = "no-referrer";
      v.src = url;
      // Persist to IDB blob cache after load (fire-and-forget)
      v.onloadeddata = () => { cacheImage(url, 1).catch(() => {}); };
      // Drop failed videos so they don't pin memory or consume the video-element
      // budget; a future hover can retry them.
      v.onerror = () => {
        preloadCache.delete(url);
        const i = videoKeys.indexOf(url);
        if (i >= 0) videoKeys.splice(i, 1);
      };
      releaseOnSettle(v, release);
      preloadCache.set(url, v);
      videoKeys.push(url);
    });
  });
}


/**
 * Warm an animated image (.webp) into the browser HTTP cache.
 * Uses new Image() (not <link rel="preload">) because:
 *  1. <link rel="preload" crossorigin> creates a CORS-mode fetch whose
 *     cache entry is NOT reused by a same-origin <img> without crossorigin.
 *  2. Some browsers don't reliably cache preload responses for <img> reuse.
 *  3. new Image() is proven for sprites and thumbnails in preload-sprite.ts.
 */
export function preloadAnimatedImage(url: string, cors = false): void {
  if (preloadCache.has(url)) return;
  // On slow connections, skip entirely — bandwidth is needed for the grid
  if (isConnectionConstrained()) return;

  // Already in the IDB blob cache — don't re-download just to warm it.
  // Checked BEFORE taking a queue slot so cached URLs never hold one of the
  // 3 concurrent downloads.
  void isCached(url).then((cached) => {
    if (cached) return;
    if (preloadCache.has(url)) return; // someone warmed it while we checked

    // Cap concurrent speculative downloads (see global gate above).
    void acquirePreloadSlot().then((release) => {
      if (preloadCache.has(url)) {
        release();
        return;
      }
      // Bound detached <img> memory — evict the oldest once at capacity.
      if (imageKeys.length >= MAX_IMAGE_ELEMENTS) {
        evictOldestImage();
      }
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      // CORS-mode loads (catbox) share their HTTP-cache entry with cacheImage's
      // fetch(), avoiding a duplicate download when persisting to IDB.
      if (cors) img.crossOrigin = "anonymous";
      img.onload = () => {
        // Persist to IDB blob cache for repeat-visit speed (fire-and-forget)
        cacheImage(url, 1).catch(() => {});
      };
      img.onerror = () => {
        // Preload failed (DNS, CORS, network) — silently remove from cache
        // so a future attempt can retry.
        preloadCache.delete(url);
        const i = imageKeys.indexOf(url);
        if (i >= 0) imageKeys.splice(i, 1);
      };
      releaseOnSettle(img, release);
      preloadCache.set(url, img);
      imageKeys.push(url);
      img.src = url;
    });
  });
}


/**
 * Preload a preview URL using the best strategy for its (probable) type.
 * Real video files (.mp4, .webm) are preloaded as <video>. .webp files are
 * preloaded as <img> only — loading them into <video> wastes a connection
 * slot and blocks the actual <img> from loading.
 */
export function preloadPreviewMedia(url: string | null | undefined): void {
  if (!url) return;
  // catbox .webp previews are rendered DIRECTLY from the browser (catbox is in
  // NO_PROXY_HOSTS and wsrv flattens/404s animated webp), so we must preload
  // the RAW catbox URL — the exact URL the <img> uses. preloadAnimatedImage
  // downloads it into the browser cache and persists it to the IDB blob cache
  // (catbox sends CORS for images), so the first hover is instant and repeat
  // hovers are zero-network. Gated by the global concurrency cap.
  const upstream = unwrapProxyUrl(url);
  if (getExt(upstream) === ".webp" && /catbox\.moe/i.test(upstream)) {
    preloadAnimatedImage(url, true);
    return;
  }
  if (isVideoUrl(url)) preloadVideo(url);
  else if (isAnimatedImageUrl(url)) preloadAnimatedImage(url);
}
