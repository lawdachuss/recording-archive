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
import { getCachedBlobUrl, cacheImage, releaseBlobUrl } from "@/lib/image-cache";

export function useCachedImage(
  url: string | null | undefined,
): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // The ORIGINAL image url (not the blob URL) that currently holds a
  // reference-counted IDB blob URL. We must release via releaseBlobUrl(url)
  // — NOT URL.revokeObjectURL — so shared blob URLs used by other cards are
  // not revoked out from under them.
  const heldUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      return;
    }

    let cancelled = false;

    // Check IDB cache asynchronously
    getCachedBlobUrl(url)
      .then((cached) => {
        if (cancelled) {
          // We acquired a reference for this lookup — release it.
          if (cached) releaseBlobUrl(url);
          return;
        }
        if (cached) {
          // Release the previous held reference before taking a new one.
          if (heldUrlRef.current && heldUrlRef.current !== url) {
            releaseBlobUrl(heldUrlRef.current);
          }
          heldUrlRef.current = url;
          setBlobUrl(cached);
          // Stale-while-revalidate: update IDB in background
          cacheImage(url, 2).catch(() => {});
        } else {
          // Not cached — return null so caller uses the original URL.
          // Release any previously held reference.
          if (heldUrlRef.current) {
            releaseBlobUrl(heldUrlRef.current);
            heldUrlRef.current = null;
          }
          setBlobUrl(null);
          // Persist to IDB so the next visit is instant
          cacheImage(url, 2).catch(() => {});
        }
      })
      .catch(() => {
        // IDB unavailable / errored — fall back to the original URL.
        if (!cancelled) setBlobUrl(null);
      });

    return () => {
      cancelled = true;
      // When url changes (not unmount), release the reference held for the
      // previous url so it isn't left dangling.
      if (heldUrlRef.current && heldUrlRef.current !== url) {
        releaseBlobUrl(heldUrlRef.current);
        heldUrlRef.current = null;
      }
    };
  }, [url]);

  // Cleanup blob URL on unmount — via the ref-counting release, never a raw
  // revoke, so a shared blob URL still referenced by sibling cards survives.
  useEffect(() => {
    return () => {
      if (heldUrlRef.current) {
        releaseBlobUrl(heldUrlRef.current);
        heldUrlRef.current = null;
      }
    };
  }, []);

  return blobUrl;
}
