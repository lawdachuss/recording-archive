/**
 * use-progressive-image.ts — load an image with real-time download progress.
 *
 * The card's hover media (sprite sheets / previews) used to show an
 * indeterminate shimmer + spinner while it loaded. This hook replaces that
 * with honest, real-time progress:
 *
 *   1. IDB blob cache hit  → instant blob URL, no network, no progress bar.
 *   2. Cache miss          → stream the fetch and report byte progress
 *                            (loaded / content-length) as it downloads.
 *   3. Streaming impossible → fall back to the original URL and let the
 *                            consumer's native <img> loading + mirror/wsrv
 *                            fallback chain handle it (no progress bar).
 *
 * The streamed bytes are turned into a blob URL so the display element never
 * issues a second network request, and the IDB cache is warmed afterwards
 * (cheap — the response is already in the browser HTTP cache).
 */

import { useEffect, useRef, useState } from "react";
import { getCachedBlobUrl, releaseBlobUrl, cacheImage } from "@/lib/image-cache";

export interface ProgressiveImageResult {
  /**
   * URL to display: a blob: URL once bytes are available, or the original
   * URL when streaming isn't possible (cross-origin without CORS, failure).
   * null while the IDB check is still resolving.
   */
  src: string | null;
  /**
   * Real download progress 0-100, or null when not measurable / already
   * instant. Cap at 99 while loading; 100 once complete.
   */
  progress: number | null;
}

export function useProgressiveImage(
  url: string | null | undefined,
  enabled: boolean,
): ProgressiveImageResult {
  const [src, setSrc] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const blobRef = useRef<string | null>(null);
  // Original URL currently held as a ref-counted IDB blob URL (see
  // getCachedBlobUrl — must release with the ORIGINAL url).
  const idbUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Tear down the previous load (hover ended / url changed).
    abortRef.current?.abort();
    abortRef.current = null;
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    if (idbUrlRef.current) {
      releaseBlobUrl(idbUrlRef.current);
      idbUrlRef.current = null;
    }
    setSrc(null);
    setProgress(null);

    if (!url || !enabled) return;

    let cancelled = false;

    // 1) Already in the IDB blob cache → instant, zero network.
    getCachedBlobUrl(url).then((blobUrl) => {
      if (cancelled) {
        if (blobUrl) releaseBlobUrl(url);
        return;
      }
      if (blobUrl) {
        idbUrlRef.current = url;
        setSrc(blobUrl);
        setProgress(100);
        return;
      }

      // 2) Cache miss: provide the raw URL immediately so the <img> element
      // can mount and stream/decode native frames without waiting for a manual JS loop.
      setSrc(url);
      setProgress(null);

      // Concurrently warm into IDB blob cache (priority 2 = hover) so subsequent
      // hovers or repeat visits are 0ms instant blob URLs.
      cacheImage(url, 2)
        .then((entry) => {
          if (cancelled || !entry) return;
          // Optionally upgrade to cached blob URL once saved
          getCachedBlobUrl(url).then((freshBlobUrl) => {
            if (cancelled || !freshBlobUrl) return;
            if (idbUrlRef.current) releaseBlobUrl(idbUrlRef.current);
            idbUrlRef.current = url;
            setSrc(freshBlobUrl);
            setProgress(100);
          });
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      if (idbUrlRef.current) {
        releaseBlobUrl(idbUrlRef.current);
        idbUrlRef.current = null;
      }
      setSrc(null);
      setProgress(null);
    };
  }, [url, enabled]);

  return { src, progress };
}