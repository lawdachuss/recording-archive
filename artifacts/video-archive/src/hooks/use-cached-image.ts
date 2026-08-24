/**
 * use-cached-image.ts — serve images from the IndexedDB blob cache
 *
 * For any image URL, checks whether it's already cached in IDB. If so,
 * returns a blob URL that renders instantly (zero network). Falls back to
 * the original URL on cache miss, and persists the image to IDB after it
 * loads so the NEXT visit is instant.
 *
 * Usage:
 *   const src = useCachedImage(recording.thumbnail_url);
 *   <img src={src ?? recording.thumbnail_url} />
 */

import { useState, useEffect, useRef } from "react";
import { getCachedBlobUrl, cacheImage } from "@/lib/image-cache";

export function useCachedImage(
  url: string | null | undefined,
): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const revokeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      return;
    }

    let cancelled = false;

    // Check IDB cache asynchronously
    getCachedBlobUrl(url).then((cached) => {
      if (cancelled) {
        if (cached) URL.revokeObjectURL(cached);
        return;
      }
      if (cached) {
        // Revoke previous blob URL to avoid memory leak
        if (revokeRef.current) URL.revokeObjectURL(revokeRef.current);
        revokeRef.current = cached;
        setBlobUrl(cached);
        // Stale-while-revalidate: update IDB in background
        cacheImage(url);
      } else {
        // Not cached — return null so caller uses the original URL
        setBlobUrl(null);
        // Persist to IDB after the <img> loads (caller should trigger this)
        // We use a MutationObserver-free approach: just fire-and-forget cacheImage
        // when the URL changes, so the next visit is cached.
        cacheImage(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (revokeRef.current) {
        URL.revokeObjectURL(revokeRef.current);
        revokeRef.current = null;
      }
    };
  }, []);

  return blobUrl;
}
