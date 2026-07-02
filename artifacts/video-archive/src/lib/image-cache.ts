/**
 * image-cache.ts — simplified image cache
 *
 * Removed the IndexedDB blob storage layer which introduced expensive
 * open → transaction → read → write round-trips on every image load.
 *
 * The browser's built-in HTTP cache (disk/memory cache, 304s) handles
 * repeated image loads faster than any custom IndexedDB solution.
 *
 * Keep this module as a re-export target so existing imports don't break.
 */

/** @deprecated Native browser cache is faster — import not needed */
export async function fetchWithCache(url: string, _init?: RequestInit): Promise<Blob> {
  const res = await fetch(url, _init);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.blob();
}

export function objectURLFromBlob(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeObjectURL(url: string) {
  URL.revokeObjectURL(url);
}

export async function clearImageCache(): Promise<void> {
  // No-op: image cache was removed in favor of native browser cache
}
