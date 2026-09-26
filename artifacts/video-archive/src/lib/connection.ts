/**
 * connection.ts — Shared connection quality helpers.
 *
 * Constrained-connection detection uses the Network Information API
 * (saveData / effectiveType / downlink) — raw signals reported by the browser,
 * NOT measured thumbnail latency (the latency approach misfired because
 * thumbnail round-trips reflect server/proxy latency, not user bandwidth).
 *
 * On normal broadband all helpers report "fast": full-size thumbnails, whole
 * page + 5-page lookahead preloading, hover previews enabled. On metered or
 * genuinely slow links (saveData, 2g, or <1 Mbps) the app backs off: it still
 * preloads the current page's sprites (the cheap hover win) but skips the
 * multi-page lookahead, the idle catalog warmer, and background preview
 * downloads.
 */

export type ConnectionQuality = "fast" | "medium" | "slow";

interface NetworkInfoLike {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

function readNetworkInfo(): NetworkInfoLike | null {
  if (typeof navigator === "undefined") return null;
  const ni = (navigator as unknown as { connection?: NetworkInfoLike }).connection;
  return ni ?? null;
}

/**
 * True on metered or genuinely slow links (explicit saveData, 2g-class
 * effectiveType, or measured downlink < 1 Mbps). Conservative on purpose —
 * 3g-class connections (>1 Mbps) and normal Wi-Fi/broadband are NOT flagged.
 */
export function isConnectionConstrained(): boolean {
  const ni = readNetworkInfo();
  if (!ni) return false;
  if (ni.saveData) return true;
  const et = typeof ni.effectiveType === "string" ? ni.effectiveType.toLowerCase() : "";
  if (et === "slow-2g" || et === "2g") return true;
  if (typeof ni.downlink === "number" && ni.downlink > 0 && ni.downlink < 1) return true;
  return false;
}

/**
 * Rough connection classification. "fast" on normal links, "slow" when the
 * constrained checks above fire.
 */
export function getConnectionQuality(): ConnectionQuality {
  return isConnectionConstrained() ? "slow" : "fast";
}

/**
 * Thumbnail request widths (px), one per *rendered* size.
 *
 * These used to be a single hardcoded 1200 for every image, which shipped
 * ~94% wasted bytes per thumbnail (Lighthouse image-delivery-insight on
 * production: "82 KiB wasted of 87 KiB") and made a 40-card grid a
 * multi-megabyte download. Each tier below is the element's CSS size at
 * roughly 2x DPR, rounded up:
 *
 *   avatar — 72/82px performer circles
 *   thumb  — 112-150px cells (related-video rail, dense performer grids)
 *   card   — ~300px grid card thumbnails (lg:grid-cols-4)
 *   hero   — full-bleed detail-page art
 */
export const THUMBNAIL_WIDTH = {
  avatar: 200,
  thumb: 320,
  card: 640,
  hero: 1200,
} as const;

export type ThumbnailTier = keyof typeof THUMBNAIL_WIDTH;

/**
 * Width to request from the media proxy for a given tier. Constrained links
 * (Data Saver / 2g / <1 Mbps) get half the pixels, floored at the proxy's own
 * 200px minimum clamp.
 */
export function getAdaptiveImageWidth(tier: ThumbnailTier = "card"): number {
  const width = THUMBNAIL_WIDTH[tier];
  if (isConnectionConstrained()) return Math.max(200, Math.round(width / 2));
  return width;
}

/**
 * Resolve an explicit `width` override — either a tier name or explicit
 * pixels — down to a concrete width. Numbers pass through so callers can size
 * to a one-off container the tiers don't cover.
 */
export function resolveImageWidth(width: ThumbnailTier | number | undefined): number | undefined {
  if (width === undefined) return undefined;
  if (typeof width === "number") return Math.round(width);
  return getAdaptiveImageWidth(width);
}

/**
 * Whether to skip ALL speculative preloading (sprites, previews, catalog warmer).
 * Always false — speculative preloading is the point of the app's fast hover UX;
 * constrained links narrow it via concurrency/clamps instead of disabling it.
 */
export function shouldSkipPreloading(): boolean {
  return false;
}