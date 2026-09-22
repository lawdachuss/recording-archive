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
import { proxyImageUrl, proxyUrl, proxySpriteUrl } from "@/lib/proxy-url";
import { cacheImage, type CachePriority } from "@/lib/image-cache";
import { isConnectionConstrained } from "@/lib/connection";
import { buildPreviewFallbacks } from "@/lib/mirrors";

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

/** True when `url` resolves to a host in the catbox family (direct browser
 *  loads only — catbox blocks our server proxy with 502s). */
export function isCatboxHost(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url, window.location.origin);
    return hostname === "catbox.moe" || hostname.endsWith(".catbox.moe");
  } catch {
    return false;
  }
}

/** True for catbox-family ANIMATED image previews (.webp), which load DIRECT
 *  from the browser (catbox in NO_PROXY_HOSTS; wsrv flattens animated webp). */
export function isCatboxAnimatedPreviewUrl(url: string | null | undefined): boolean {
  return !!url && isAnimatedPreviewUrl(url) && isCatboxHost(url);
}

/** True when a preview URL is worth background-warming:
 *  - any animated (non-video) preview on a reachable host — proxied /api/media,
 *    wsrv, pixhost direct; OR
 *  - a catbox-hosted animated image: catbox sends CORS for images, so warming
 *    it into the HTTP + IDB caches ahead of hover is exactly what makes the
 *    hover instant instead of streaming a ~2s progress bar.
 *  Multi-MB videos always remain stream-on-demand (animated requirement).
 */
export function isPreviewPreloadable(url: string | null | undefined): boolean {
  if (!url) return false;
  if (!isAnimatedPreviewUrl(url)) return false;
  return isReachablePreviewUrl(url) || isCatboxHost(url);
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
const MAX_ACTIVE = 16;

const queue: Array<{
  url: string;
  priority: CachePriority;
  immediate: boolean;
}> = [];
let activeCount = 0;
let pumpTimer: number | null = null;
// Dirty flag: set true whenever new items are enqueued or priorities changed.
// pump() sorts ONLY when dirty — avoids the repeated O(n log n) sort that
// happened on every request completion during a 240-item warm burst.
let queueDirty = false;

function getConcurrency(): number {
  if (isConnectionConstrained()) return 2; // Only 2 concurrent loads on slow connections
  return MAX_ACTIVE;
}

// wsrv.nl already has its own edge CDN cache — the browser HTTP cache is
// sufficient for repeat visits. Calling fetch() on wsrv URLs just generates
// 404 console noise when catbox files are 0-byte/deleted (wsrv returns 404,
// the blob is never stored, but the error still appears in DevTools). Use
// new Image() for wsrv thumbnails to warm the HTTP cache silently instead.
function isWsrvUrl(url: string): boolean {
  return url.includes("wsrv.nl") || url.includes("weserv.nl");
}

function warmHttpCache(url: string) {
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.src = url;
  // Silent — no onerror handler; 404s don't produce console noise from Image()
}

// All preloads go through cacheImage() — the same single-flight, per-host
// concurrency-limited fetch used by OptimizedImage's visible <img>. This means
// a preload and the visible card for the SAME url share ONE network request
// (no doubling), and catbox can never be burst with more than a few concurrent
// connections no matter how many cards/preloads reference it.
// Exception: wsrv.nl URLs are warmed via new Image() (HTTP cache only) because
// wsrv has its own edge CDN and fetch() produces noisy 404s for broken catbox files.
function startRequest(url: string, priority: CachePriority = 3) {
  activeCount++;
  if (isWsrvUrl(url)) {
    // Warm browser HTTP cache only — no IDB fetch, no 404 console noise.
    try { warmHttpCache(url); } catch { /* non-fatal */ }
    activeCount--;
    pump();
    return;
  }
  cacheImage(url, priority)
    .then(() => {
      // Note: cacheImage resolving null is NOT a failure — null also means
      // "skipped" (already fresh within the revalidate window, oversized/
      // corrupt body, or a deliberately non-cached cross-origin URL). Those
      // must NOT be treated as failures or the URL is needlessly blacklisted
      // from re-warming for the cooldown period. Only a rejected promise is a
      // real failure worth a delayed retry.
    })
    .catch(() => {
      failedAt.set(url, Date.now());
    })
    .finally(() => {
      activeCount--;
      pump();
    });
}

function pump() {
  if (pumpTimer !== null) {
    window.clearTimeout(pumpTimer);
    pumpTimer = null;
  }
  // Sort ONLY when new items were enqueued or priorities changed — avoids the
  // repeated O(n log n) sort that fired on every request completion during a
  // high-throughput warm burst (up to 240 items, dozens of calls/sec).
  if (queueDirty) {
    // Immediate tasks first, then by descending priority — so first-screen
    // thumbnails are fetched before the long background tail.
    queue.sort((a, b) => {
      if (a.immediate !== b.immediate) return a.immediate ? -1 : 1;
      return b.priority - a.priority;
    });
    queueDirty = false;
  }
  const maxActive = getConcurrency();
  while (queue.length > 0 && activeCount < maxActive) {
    const item = queue.shift()!;
    startRequest(item.url, item.priority);
  }
  // Re-pump after a short delay in case active slots freed up
  if (queue.length > 0 && pumpTimer === null) {
    pumpTimer = window.setTimeout(pump, 50);
  }
}

export interface PreloadOptions {
  /** 1 = preview (evict first), 2 = sprite, 3 = thumbnail (evict last). */
  priority?: CachePriority;
  /** Jump the queue to the front (first-screen thumbnails). */
  immediate?: boolean;
  /** Skip animated preview warming (used for far lookahead pages). */
  skipPreviews?: boolean;
}

/**
 * Warm a single image into the HTTP cache + service worker cache + IDB blob
 * cache. Idempotent per URL for the lifetime of the page. Returns immediately.
 */
export function preloadImage(
  url: string | null | undefined,
  opts: PreloadOptions = {},
): void {
  if (!url) return;
  if (isConnectionConstrained() && !opts.immediate) return;
  const priority = opts.priority ?? 3;
  const immediate = opts.immediate ?? false;
  if (warmed.has(url)) {
    const last = failedAt.get(url) ?? 0;
    if (last && Date.now() - last >= FAILED_RETRY_COOLDOWN_MS) {
      // Cooldown elapsed since the last failure — permit a fresh attempt.
      failedAt.delete(url);
      warmed.delete(url);
    } else {
      // Already enqueued (e.g. by the idle full-catalog warmer) but not
      // started yet — a hot request should not wait behind the whole catalog.
      // Move it to the head (or to the immediate front if it just became hot).
      const idx = queue.findIndex((item) => item.url === url);
      if (idx >= 0) {
        const [item] = queue.splice(idx, 1);
        if (immediate) item.immediate = true;
        queue.unshift(item);
        queueDirty = true;
        pump();
      }
      return;
    }
  }
  warmed.add(url);
  queue.push({ url, priority, immediate });
  queueDirty = true;
  pump();
}

/**
 * Batch-warm many images. Items are dedup'd against already-warmed / in-queue
 * URLs; actual starts are paced by the global queue (see above). Always
 * returns immediately.
 */
export function preloadImages(
  urls: (string | null | undefined)[],
  opts: PreloadOptions = {},
): void {
  if (typeof window === "undefined") return;
  for (const url of urls) preloadImage(url, opts);
}

/**
 * Warm all hover media for a list of recordings: thumbnails (grid paint,
 * priority 3) first, then sprites (priority 2), and previews eagerly. Previews
 * use <link rel="preload" as="image"> for instant HTTP/2 priority so they're
 * cached before the user hovers.
 */
export function preloadRecordingAssets(
  recs: Array<{
    sprite_url?: string | null;
    thumbnail_url?: string | null;
    preview_url?: string | null;
    preview_mirrors?: Record<string, string> | null;
    sprite_mirrors?: Record<string, string> | null;
    thumbnail_mirrors?: Record<string, string> | null;
  }>,
  opts: PreloadOptions = {},
): void {
  const thumbs: (string | null | undefined)[] = [];
  const sprites: (string | null | undefined)[] = [];
  const previews: (string | null | undefined)[] = [];
  for (const rec of recs) {
    if (rec.thumbnail_url) thumbs.push(proxyImageUrl(rec.thumbnail_url));
    if (rec.sprite_url) {
      const proxied = proxySpriteUrl(rec.sprite_url);
      if (isReachablePreviewUrl(proxied)) sprites.push(proxied);
    }
    // Check primary and mirrors for the best preloadable preview (preferring animated WebP)
    const candidates = buildPreviewFallbacks(rec);
    const best = candidates.find((u) => isPreviewPreloadable(u)) ?? (rec.preview_url && isPreviewPreloadable(rec.preview_url) ? rec.preview_url : null);
    if (best && previews.length < 4) {
      const proxied = proxyUrl(best);
      if (proxied) previews.push(proxied);
    }
  }
  preloadImages(thumbs, { ...opts, priority: 3 });
  preloadImages(sprites, { ...opts, priority: 2 });
  if (previews.length) {
    previews.forEach((p) => preloadPreviewMedia(p));
  }
}

/**
 * Warm ALL grid + hover media for a list of recordings:
 *   - thumbnails (priority 3): warmed in the BACKGROUND (not immediate) so the
 *     grid's own <img> requests for the first screen take priority. Below-fold
 *     thumbnails get their one-and-only fetch here (lazy <img>s haven't fired
 *     yet), and the <img> that later mounts finds the bytes in the HTTP cache.
 *   - sprites (priority 2): immediate — hover preview sheets aren't in the DOM.
 *   - reachable ANIMATED previews (.webp / .mp4_preview): priority 1, via the
 *     global preview cap. Preloads best candidate from primary or mirrors.
 *
 * Video previews (.mp4 / .webm) are deliberately NOT prefetched here: they are
 * multi-MB files and warming every card on every page would saturate the
 * connection and multiply origin traffic at scale. They stream on demand at
 * hover and persist to IDB on first hover.
 */
export function preloadRecordingMedia(
  recs: Array<{
    thumbnail_url?: string | null;
    sprite_url?: string | null;
    preview_url?: string | null;
    preview_mirrors?: Record<string, string> | null;
    sprite_mirrors?: Record<string, string> | null;
    thumbnail_mirrors?: Record<string, string> | null;
  }>,
  opts: PreloadOptions = {},
): void {
  const thumbs: (string | null | undefined)[] = [];
  const sprites: (string | null | undefined)[] = [];
  const previews: (string | null | undefined)[] = [];
  for (const rec of recs) {
    if (rec.thumbnail_url) thumbs.push(proxyImageUrl(rec.thumbnail_url));
    if (rec.sprite_url) {
      const proxied = proxySpriteUrl(rec.sprite_url);
      if (isReachablePreviewUrl(proxied)) sprites.push(proxied);
    }
    if (!opts.skipPreviews && previews.length < 4) {
      // Find the best animated preview candidate from primary URL or mirrors
      const candidates = buildPreviewFallbacks(rec);
      const best = candidates.find((u) => isPreviewPreloadable(u)) ?? (rec.preview_url && isPreviewPreloadable(rec.preview_url) ? rec.preview_url : null);
      if (best) {
        const proxied = proxyUrl(best);
        if (proxied) previews.push(proxied);
      }
    }
  }
  // Background: never pop thumbnails to the front of the queue. The visible
  // <img> tags already fetch first-screen thumbs at paint; forcing them ahead
  // here would double those requests and compete with grid paint.
  preloadImages(thumbs, { ...opts, priority: 3, immediate: false });
  preloadImages(sprites, { ...opts, priority: 2 });
  for (const p of previews) preloadPreviewMedia(p);
}

/**
 * Warm only hover sprites for a list of recordings. Used for page-level
 * preloads where the DOM <img> tags already fetch thumbnails themselves —
 * preloading them again would double the requests and compete with grid paint.
 *
 * Preview media is deliberately NOT preloaded here. Previews are multi-MB
 * files; warming a whole page of them saturated the connection and slowed the
 * grid. Cards near the viewport preload their own preview via useHoverPreview,
 * which preload-preview.ts caps to a few concurrent downloads.
 *
 * Sprites on catbox hosts ride wsrv.nl's edge CDN full-size (proxySpriteUrl),
 * so they're now reachable AND fast to warm (~2-3s cold, globally-cached after
 * the first viewer) — the old ~16KB/s direct-download starvation is gone.
 * Catbox animated .webp previews are warmed directly into the HTTP + IDB
 * caches (catbox sends CORS for images) so hover is instant, not a progress
 * bar. Videos stay stream-on-demand at hover time.
 */
export function preloadRecordingSprites(
  recs: Array<{ sprite_url?: string | null; preview_url?: string | null }>,
  opts: PreloadOptions = {},
): void {
  const sprites: (string | null | undefined)[] = [];
  const previews: (string | null | undefined)[] = [];
  for (const rec of recs) {
    if (rec.sprite_url) {
      const proxied = proxySpriteUrl(rec.sprite_url);
      if (isReachablePreviewUrl(proxied)) sprites.push(proxied);
    }
    // Prefetch ANIMATED previews (.webp / .mp4_preview) alongside sprites so
    // hover shows the full preview instantly. Videos (.mp4) are excluded —
    // they're multi-MB and still stream on demand at hover time.
    if (rec.preview_url && !opts.skipPreviews) {
      const proxied = proxyUrl(rec.preview_url);
      if (proxied && isPreviewPreloadable(proxied)) {
        previews.push(proxied);
      }
    }
  }
  preloadImages(sprites, { ...opts, priority: 2 });
  if (previews.length) {
    for (const p of previews) preloadPreviewMedia(p);
  }
}

/** True when a (proxied) preview URL points at an animated image, not a video. */
export function isAnimatedPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    let inner = parsed.pathname;
    // Unwrap the /api/media proxy so the upstream extension is visible.
    if (parsed.pathname.startsWith("/api/media")) {
      const u = parsed.searchParams.get("url");
      if (u) inner = new URL(u).pathname;
    }
    const dot = inner.lastIndexOf(".");
    const ext = dot >= 0 ? inner.slice(dot).toLowerCase() : "";
    return ext === ".webp" || ext === ".mp4_preview";
  } catch {
    return false;
  }
}

/** @deprecated alias — use preloadImage */
export const preloadSprite = preloadImage;
/** @deprecated alias — use preloadImages */
export const preloadSprites = preloadImages;