import { useEffect, useRef, useState } from "react";
import { getCachedBlobUrl, releaseBlobUrl } from "@/lib/image-cache";

/**
 * Resolve a media URL (video preview / animated image) to its IDB-cached blob
 * URL when available, falling back to the original network URL. Lets hover
 * playback start instantly from the cache (warmed by preload-preview.ts)
 * instead of re-fetching the bytes on every hover. Acquires/releases the blob
 * URL reference so the underlying object URL is never revoked mid-render.
 */
export function useCachedMediaSrc(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(url ?? null);
  const heldUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // Release any previously-held blob reference (URL changed).
    if (heldUrlRef.current) {
      releaseBlobUrl(heldUrlRef.current);
      heldUrlRef.current = null;
    }
    if (!url) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    setSrc(url); // start at network URL, upgrade to blob if cached
    getCachedBlobUrl(url).then((blobUrl) => {
      if (cancelled) {
        if (blobUrl) releaseBlobUrl(url);
        return;
      }
      if (blobUrl) {
        heldUrlRef.current = url;
        setSrc(blobUrl);
      }
    });
    return () => {
      cancelled = true;
      if (heldUrlRef.current) {
        releaseBlobUrl(heldUrlRef.current);
        heldUrlRef.current = null;
      }
    };
  }, [url]);

  return src;
}
