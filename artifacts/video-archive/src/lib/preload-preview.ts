/**
 * preload-preview.ts — shared preview media preloading.
 *
 * Warms the browser HTTP cache (and, via the service worker, the Cache API)
 * for preview clips and images BEFORE they are needed, so hover playback and
 * next-page rendering start instantly. Preload elements are created detached;
 * the browser still fetches their source and the service worker caches media
 * responses for repeat visits.
 */

import { cacheImage } from "@/lib/image-cache";
import { isConnectionConstrained } from "@/lib/connection";

const preloadCache = new Map<string, HTMLVideoElement | HTMLImageElement | true>();

// Maximum number of detached video elements to keep alive.
// Each preview video holds a reference to the decoded media in memory.
const MAX_VIDEO_ELEMENTS = 20;

// Separate queue tracking video URLs for O(1) eviction (FIFO order).
const videoKeys: string[] = [];



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

export function preloadVideo(url: string): void {
  if (preloadCache.has(url)) return;
  // Don't preload on slow/constrained connections — the bandwidth is needed
  // for the actual page content, not speculative hover previews.
  if (isConnectionConstrained()) return;

  // Enforce memory limit — evict oldest video if we're at capacity
  if (videoKeys.length >= MAX_VIDEO_ELEMENTS) {
    evictOldestVideo();
  }

  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  (v as HTMLVideoElement & { referrerPolicy?: string }).referrerPolicy = "no-referrer";
  v.src = url;
  // Persist to IDB blob cache after load (fire-and-forget)
  v.onloadeddata = () => { cacheImage(url, 1).catch(() => {}); };
  preloadCache.set(url, v);
  videoKeys.push(url);
}

/**
 * Warm an animated image (.webp) into the browser HTTP cache.
 * Uses new Image() (not <link rel="preload">) because:
 *  1. <link rel="preload" crossorigin> creates a CORS-mode fetch whose
 *     cache entry is NOT reused by a same-origin <img> without crossorigin.
 *  2. Some browsers don't reliably cache preload responses for <img> reuse.
 *  3. new Image() is proven for sprites and thumbnails in preload-sprite.ts.
 */
export function preloadAnimatedImage(url: string): void {
  if (preloadCache.has(url)) return;
  // On slow connections, skip entirely — bandwidth is needed for the grid
  if (isConnectionConstrained()) return;

  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.decoding = "async";
  img.onload = () => {
    // Persist to IDB blob cache for repeat-visit speed (fire-and-forget)
    cacheImage(url, 1).catch(() => {});
  };
  img.onerror = () => {
    // Preload failed (DNS, CORS, network) — silently remove from cache
    // so a future attempt can retry.
    preloadCache.delete(url);
  };
  preloadCache.set(url, img);
  img.src = url;
}

/**
 * Preload a preview URL using the best strategy for its (probable) type.
 * Real video files (.mp4, .webm) are preloaded as <video>. .webp files are
 * preloaded as <img> only — loading them into <video> wastes a connection
 * slot and blocks the actual <img> from loading.
 */
export function preloadPreviewMedia(url: string | null | undefined): void {
  if (!url) return;
  // catbox .webp previews are shown via the animating sprite instead of an
  // <img> (wsrv flattens/404s them), so don't waste bandwidth warming them
  // through wsrv — that fetch 404s too. Real catbox MP4 videos still preload.
  const upstream = unwrapProxyUrl(url);
  if (getExt(upstream) === ".webp" && /catbox\.moe/i.test(upstream)) return;
  if (isVideoUrl(url)) preloadVideo(url);
  else if (isAnimatedImageUrl(url)) preloadAnimatedImage(url);
}
