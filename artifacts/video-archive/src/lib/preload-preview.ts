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

const preloadCache = new Map<string, HTMLVideoElement | HTMLImageElement | HTMLLinkElement | true>();

// Maximum number of detached video elements to keep alive.
// Each preview video holds a reference to the decoded media in memory.
const MAX_VIDEO_ELEMENTS = 20;

// Separate queue tracking video URLs for O(1) eviction (FIFO order).
const videoKeys: string[] = [];

// Track <link rel="preload"> elements so we can remove stale ones
// when the limit is reached, preventing unbounded DOM growth.
const preloadLinks: Array<{ url: string; el: HTMLLinkElement }> = [];
const MAX_PRELOAD_LINKS = 50;

function isConnectionConstrained(): boolean {
  try {
    const conn = (navigator as any).connection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const slow = ["slow-2g", "2g", "3g"];
    return typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType);
  } catch {
    return false;
  }
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
  } catch {
    // Not parseable — fall through to the raw string.
  }
  return url;
}

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = unwrapProxyUrl(url).toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".mov") ||
    lower.includes(".m3u8")
  );
}

export function isAnimatedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return unwrapProxyUrl(url).toLowerCase().endsWith(".webp");
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
  v.onloadeddata = () => { cacheImage(url); };
  preloadCache.set(url, v);
  videoKeys.push(url);
}

/**
 * Warm an animated image (.webp) into the browser cache.
 * Uses <link rel="preload"> for HTTP/2 server-push priority — the browser
 * fetches the resource at high priority and caches it for instant reuse when
 * the actual <img> element renders on hover.
 */
export function preloadAnimatedImage(url: string): void {
  if (preloadCache.has(url)) return;
  // On slow connections, skip entirely — bandwidth is needed for the grid
  if (isConnectionConstrained()) return;

  // Evict oldest <link> if we're at capacity to prevent unbounded DOM growth.
  if (preloadLinks.length >= MAX_PRELOAD_LINKS) {
    const oldest = preloadLinks.shift();
    if (oldest) {
      oldest.el.remove();
      preloadCache.delete(oldest.url);
    }
  }

  // <link rel="preload" as="image"> is the highest-priority hint a page
  // can give the browser. Unlike new Image(), the browser treats it as a
  // critical resource and fetches it immediately (not deferred to idle).
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;
  link.referrerPolicy = "no-referrer";
  if (url.startsWith("/")) {
    link.crossOrigin = "anonymous";
  }
  document.head.appendChild(link);
  // Persist to IDB blob cache after successful load (fire-and-forget)
  link.onload = () => { cacheImage(url); };
  preloadCache.set(url, true);
  preloadLinks.push({ url, el: link });
}

/**
 * Preload a preview URL using the best strategy for its (probable) type.
 * Real video files (.mp4, .webm) are preloaded as <video>. .webp files are
 * preloaded as <img> only — loading them into <video> wastes a connection
 * slot and blocks the actual <img> from loading.
 */
export function preloadPreviewMedia(url: string | null | undefined): void {
  if (!url) return;
  if (isVideoUrl(url)) preloadVideo(url);
  else if (isAnimatedImageUrl(url)) preloadAnimatedImage(url);
}
