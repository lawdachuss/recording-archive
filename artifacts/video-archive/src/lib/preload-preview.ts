/**
 * preload-preview.ts — shared preview media preloading.
 *
 * Warms the browser HTTP cache (and, via the service worker, the Cache API)
 * for preview clips and images BEFORE they are needed, so hover playback and
 * next-page rendering start instantly. Preload elements are created detached;
 * the browser still fetches their source and the service worker caches media
 * responses for repeat visits.
 */

const preloadCache = new Map<string, HTMLVideoElement | HTMLImageElement | true>();

// Maximum number of detached video elements to keep alive.
// Each preview video holds a reference to the decoded media in memory.
const MAX_VIDEO_ELEMENTS = 20;

// Separate queue tracking video URLs for O(1) eviction (FIFO order).
const videoKeys: string[] = [];

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

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".mov") ||
    lower.includes(".m3u8")
  );
}

export function isAnimatedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.toLowerCase().endsWith(".webp");
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
  if (isConnectionConstrained()) return;

  // <link rel="preload" as="image"> is the highest-priority hint a page
  // can give the browser. Unlike new Image(), the browser treats it as a
  // critical resource and fetches it immediately (not deferred to idle).
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;
  link.referrerPolicy = "no-referrer";
  // Cross-origin for proxied URLs (/api/media), same-origin for direct loads
  if (url.startsWith("/")) {
    link.crossOrigin = "anonymous";
  }
  document.head.appendChild(link);
  preloadCache.set(url, true);
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
