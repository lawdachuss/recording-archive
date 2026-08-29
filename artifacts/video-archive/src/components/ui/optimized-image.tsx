import { useState, useCallback, useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";
import { proxyUrl } from "@/lib/proxy-url";
import { getCachedBlobUrl, cacheImage } from "@/lib/image-cache";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  fallback?: React.ReactNode;
  fetchPriority?: "high" | "low" | "auto";
  loading?: "eager" | "lazy";
  noShimmer?: boolean;
}

/**
 * Light "Image unavailable" placeholder — mirrors the SVG the media proxy
 * returns for upstream failures (media-proxy.ts FALLBACK_SVG). Using the same
 * light styling keeps every missing/errored thumbnail consistent: proxied
 * failures already render light gray, so direct-load (catbox) failures must
 * too instead of dropping to a near-black dark fallback.
 */
export function ImageUnavailable({ initials, className }: { initials?: string; className?: string }) {
  return (
    <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#f3f4f6]", className)}>
      <svg
        className="w-8 h-8 text-[#9ca3af]"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      {initials ? (
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#6b7280]">
          {initials}
        </span>
      ) : (
        <span className="text-[9px] font-medium tracking-wider uppercase text-[#9ca3af]">
          Image unavailable
        </span>
      )}
    </div>
  );
}

/** Default placeholder rendered when the image fails to load and no custom fallback is provided. */
function DefaultFallback() {
  return <ImageUnavailable />;
}

export const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  className,
  containerClassName,
  fallback,
  fetchPriority,
  loading,
  noShimmer = false,
}: OptimizedImageProps) {
  // Route the image through the media proxy unless it's local / already proxied.
  const resolvedSrc = proxyUrl(src) ?? src;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const prevSrcRef = useRef(resolvedSrc);
  const blobUrlRef = useRef<string | null>(null);
  const [displaySrc, setDisplaySrc] = useState<string>(resolvedSrc);

  // Check IDB blob cache on mount and whenever src changes.
  // On repeat visits, serves from blob URL instantly (zero network).
  useEffect(() => {
    setLoaded(false);
    setError(false);
    prevSrcRef.current = resolvedSrc;

    let cancelled = false;
    getCachedBlobUrl(resolvedSrc).then((blobUrl) => {
      if (cancelled) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }
      if (blobUrl) {
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = blobUrl;
        setDisplaySrc(blobUrl);
        // Stale-while-revalidate: update IDB in background (thumbnail = hot)
        cacheImage(resolvedSrc, 3);
      } else {
        setDisplaySrc(resolvedSrc);
        // Not cached — persist for next visit after image loads
        cacheImage(resolvedSrc, 3);
      }
    });
    return () => { cancelled = true; };
  }, [resolvedSrc]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const [retryCount, setRetryCount] = useState(0);
  const onLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  const onError = useCallback(() => {
    // If displaying a stale blob URL, fall back to the original URL
    if (blobUrlRef.current && displaySrc.startsWith("blob:")) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      if (retryCount === 0) {
        setRetryCount(1);
        setDisplaySrc(resolvedSrc);
        return;
      }
    }
    setError(true);
    setLoaded(true);
  }, [displaySrc, resolvedSrc, retryCount]);

  if (error) {
    return fallback ?? <DefaultFallback />;
  }

  return (
    <div className={cn("relative overflow-hidden bg-secondary", containerClassName)}>
      <img
        src={displaySrc}
        alt={alt}
        referrerPolicy="no-referrer"
        loading={loading ?? (fetchPriority === "high" ? "eager" : "lazy")}
        decoding="async"
        fetchPriority={fetchPriority}
        onLoad={onLoad}
        onError={onError}
        className={cn("absolute inset-0 w-full h-full object-cover", className)}
      />
      {!loaded && !noShimmer && (
        <div className="absolute inset-0 z-10 bg-secondary">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_0.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      )}
    </div>
  );
});
