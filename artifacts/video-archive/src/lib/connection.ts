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
 * Width (px) to request from the image proxy for thumbnails. Full quality.
 */
export function getAdaptiveImageWidth(): number {
  return 1200;
}

/**
 * Whether to skip ALL speculative preloading (sprites, previews, catalog warmer).
 * Always false — speculative preloading is the point of the app's fast hover UX;
 * constrained links narrow it via concurrency/clamps instead of disabling it.
 */
export function shouldSkipPreloading(): boolean {
  return false;
}