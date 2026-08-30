/**
 * connection.ts — Shared connection quality detection.
 *
 * Single source of truth for all connection-related checks across the app.
 * Uses the Network Information API (navigator.connection) where available.
 */

import { isDataSaver } from "./data-saver";
import { getAdaptiveTier, getAdaptiveImageWidth as getAdaptiveImageWidthImpl } from "./adaptive-quality";

export type ConnectionQuality = "fast" | "medium" | "slow";

/**
 * Detect if the user is on a constrained connection (slow-2g, 2g, 3g, or
 * save-data mode). Used throughout the app to skip preloading, reduce page
 * sizes, and disable hover previews.
 */
export function isConnectionConstrained(): boolean {
  try {
    const conn = (navigator as any).connection;
    if (conn) {
      if (conn.saveData) return true;
      const slow = ["slow-2g", "2g", "3g"];
      if (typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType)) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  // Data Saver (manual override) or automatically measured slow thumbnails
  // both count as constrained: bandwidth should go only to what's visible.
  if (isDataSaver()) return true;
  return getAdaptiveTier() < 1200;
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
 * Width (px) to request from the image proxy for thumbnails. Delegates to the
 * live, measurement-based controller in adaptive-quality (which also honors
 * Data Saver). Smaller = less data + faster first paint on slow links.
 */
export function getAdaptiveImageWidth(): number {
  return getAdaptiveImageWidthImpl();
}

/**
 * Whether to skip ALL speculative preloading (sprites, previews, catalog warmer).
 * On constrained connections (network API OR automatically measured slowness) or
 * with Data Saver on, bandwidth should go only to what's actually visible.
 */
export function shouldSkipPreloading(): boolean {
  return isConnectionConstrained();
}
