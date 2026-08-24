/**
 * connection.ts — Shared connection quality detection.
 *
 * Single source of truth for all connection-related checks across the app.
 * Uses the Network Information API (navigator.connection) where available.
 */

export type ConnectionQuality = "fast" | "medium" | "slow";

/**
 * Detect if the user is on a constrained connection (slow-2g, 2g, 3g, or
 * save-data mode). Used throughout the app to skip preloading, reduce page
 * sizes, and disable hover previews.
 */
export function isConnectionConstrained(): boolean {
  try {
    const conn = (navigator as any).connection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const slow = ["slow-2g", "2g", "3g"];
    return (
      typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType)
    );
  } catch {
    return false;
  }
}

/**
 * Get a rough classification of the user's connection speed.
 * - "fast": 4g or no connection API
 * - "medium": 3g
 * - "slow": 2g, slow-2g, or save-data
 */
export function getConnectionQuality(): ConnectionQuality {
  try {
    const conn = (navigator as any).connection;
    if (!conn) return "fast";
    if (conn.saveData) return "slow";
    const type = conn.effectiveType as string | undefined;
    if (!type) return "fast";
    if (type === "slow-2g" || type === "2g") return "slow";
    if (type === "3g") return "medium";
    return "fast";
  } catch {
    return "fast";
  }
}

/**
 * Get the recommended page size based on connection quality.
 * Fast connections get the full 24 items, slow connections get 12.
 */
export function getRecommendedPageSize(): number {
  const quality = getConnectionQuality();
  if (quality === "slow") return 12;
  if (quality === "medium") return 18;
  return 24;
}

/**
 * Whether to skip ALL speculative preloading (sprites, previews, catalog warmer).
 * On slow connections, bandwidth should go only to what the user is actually
 * viewing — not to what they MIGHT hover over or scroll to.
 */
export function shouldSkipPreloading(): boolean {
  return isConnectionConstrained();
}
