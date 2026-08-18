/**
 * sprite-grid.ts — shared sprite layout detection.
 *
 * Sprite sheets are a single image divided into a grid of frames. Known
 * producers publish a predictable grid; anything unknown falls back to
 * auto-detection in SpriteSlideshow (measure the loaded image and divide by
 * the 16:9 frame aspect).
 */
export function getSpriteGrid(url: string | null | undefined): { cols: number; rows: number } | null {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    if (hostname.includes("pixhost.to")) return { cols: 4, rows: 4 };
    return null;
  } catch {
    return null;
  }
}
