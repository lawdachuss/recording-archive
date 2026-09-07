/**
 * connection.ts — Shared connection quality helpers.
 *
 * Automatic "slow connection" detection (Network Information API + measured
 * thumbnail load times) and the manual Data Saver toggle were both removed:
 * the detection misfired on fast connections because thumbnail latency
 * reflects server/proxy round-trips, not user bandwidth.
 *
 * The app now always behaves as if on a fast, unconstrained connection:
 * full-size thumbnails, preloads and hover previews enabled, full page sizes.
 */

export type ConnectionQuality = "fast" | "medium" | "slow";

/**
 * Always false — constrained-connection behavior was removed. Kept as a
 * constant so existing call sites stay valid and read clearly.
 */
export function isConnectionConstrained(): boolean {
  return false;
}

/**
 * Rough connection classification. Always "fast".
 */
export function getConnectionQuality(): ConnectionQuality {
  return "fast";
}

/**
 * Width (px) to request from the image proxy for thumbnails. Full quality.
 */
export function getAdaptiveImageWidth(): number {
  return 1200;
}

/**
 * Whether to skip ALL speculative preloading (sprites, previews, catalog warmer).
 * Always false — bandwidth is the user's call.
 */
export function shouldSkipPreloading(): boolean {
  return false;
}
