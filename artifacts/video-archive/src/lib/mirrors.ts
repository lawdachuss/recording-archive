/**
 * Mirror fallback utility.
 * Builds an ordered list of URLs to try: primary first, then mirrors in priority order.
 * Host priority: Catbox > Pixhost > ImgChest > iili.io/freeimage.host (most reliable first)
 */

export const MIRROR_HOST_PRIORITY = [
  "Catbox",
  "Pixhost", 
  "ImgChest",
  "freeimage.host",
];

export interface MirrorMap {
  [host: string]: string;
}

export interface UrlFallbackConfig {
  primaryUrl: string | null | undefined;
  mirrors: MirrorMap | null | undefined;
  preferAnimated?: boolean; // prefer .webp/.mp4_preview over .th.webp
}

/**
 * Build an ordered array of URLs to try, from most preferred to least.
 * Returns empty array if no URLs available.
 */
export function buildUrlFallbacks(config: UrlFallbackConfig): string[] {
  const { primaryUrl, mirrors, preferAnimated } = config;

  // Gather all URLs (primary first, then mirrors in host priority order), deduped.
  const ordered: string[] = [];
  const push = (url: string | null | undefined) => {
    if (url && isValidUrl(url) && !ordered.includes(url)) ordered.push(url);
  };

  push(primaryUrl);
  if (mirrors && typeof mirrors === "object") {
    for (const host of MIRROR_HOST_PRIORITY) push(mirrors[host]);
    for (const [host, url] of Object.entries(mirrors)) {
      if (!MIRROR_HOST_PRIORITY.includes(host)) push(url);
    }
  }

  // Thumbnails/sprites: keep primary first, then mirrors — no reordering.
  if (!preferAnimated) return ordered;

  // Previews: prefer animated sources (.webp / .mp4_preview) over static
  // thumbnails (.th.webp). Try every animated URL first, then static ones as a
  // last resort — so an animated catbox/pixhost mirror is used even when the
  // primary preview_url happens to be a static iili.io thumbnail.
  const animated = ordered.filter((u) => !isStaticThumbnail(u));
  const staticUrls = ordered.filter((u) => isStaticThumbnail(u));
  return [...animated, ...staticUrls];
}

/**
 * Check if URL is a static thumbnail (not animated)
 */
function isStaticThumbnail(url: string): boolean {
  return /\.th\.webp$/i.test(url) || /_thumb\./i.test(url);
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the best single URL for a given media type (thumbnail/sprite/preview)
 * considering mirrors and preferences.
 */
export function getBestUrl(
  primaryUrl: string | null | undefined,
  mirrors: MirrorMap | null | undefined,
  options: { preferAnimated?: boolean; type?: "preview" | "thumbnail" | "sprite" } = {}
): string | null {
  const urls = buildUrlFallbacks({ primaryUrl, mirrors, preferAnimated: options.preferAnimated ?? (options.type === "preview") });
  return urls[0] || primaryUrl || null;
}

/**
 * Build all fallback URLs for VideoCard preview (handles both image and video previews)
 */
export function buildPreviewFallbacks(recording: {
  preview_url?: string | null;
  preview_mirrors?: Record<string, string> | null;
}): string[] {
  return buildUrlFallbacks({
    primaryUrl: recording.preview_url,
    mirrors: recording.preview_mirrors,
    preferAnimated: true,
  });
}

/**
 * Build all fallback URLs for sprite
 */
export function buildSpriteFallbacks(recording: {
  sprite_url?: string | null;
  sprite_mirrors?: Record<string, string> | null;
}): string[] {
  return buildUrlFallbacks({
    primaryUrl: recording.sprite_url,
    mirrors: recording.sprite_mirrors,
    preferAnimated: false,
  });
}

/**
 * Build all fallback URLs for thumbnail
 */
export function buildThumbnailFallbacks(recording: {
  thumbnail_url?: string | null;
  thumbnail_mirrors?: Record<string, string> | null;
}): string[] {
  return buildUrlFallbacks({
    primaryUrl: recording.thumbnail_url,
    mirrors: recording.thumbnail_mirrors,
    preferAnimated: false,
  });
}