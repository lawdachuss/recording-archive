import { useEffect, useRef, useState } from "react";

interface UseCachedImageResult {
  url: string | null;
  loaded: boolean;
  error: boolean;
}

/**
 * Lightweight image loader that uses native browser HTTP cache (304s, disk cache)
 * instead of IndexedDB blob storage. This avoids the expensive IndexedDB
 * open → transaction → read → write round-trip on every image load.
 *
 * For repeated loads, the browser's built-in disk/memory cache handles it
 * faster than any custom IndexedDB solution.
 */
export function useCachedImage(src: string | null | undefined): UseCachedImageResult {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const prevSrcRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!src) {
      setLoaded(false);
      setError(false);
      prevSrcRef.current = null;
      return;
    }

    if (src === prevSrcRef.current) return;

    setLoaded(false);
    setError(false);
    prevSrcRef.current = src;

    const img = new Image();
    img.fetchPriority = "auto";
    img.loading = "lazy";

    img.onload = () => {
      if (mountedRef.current) {
        setLoaded(true);
      }
    };

    img.onerror = () => {
      if (mountedRef.current) {
        setError(true);
        setLoaded(true);
      }
    };

    img.src = src;

    // If the image is already cached (naturalWidth > 0), fire onload immediately
    if (img.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }

    return () => {
      // Prevent state updates on unmounted component
    };
  }, [src]);

  return { url: src ?? null, loaded, error };
}
