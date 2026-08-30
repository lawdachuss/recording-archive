import { useState, useCallback, useEffect, memo } from "react";
import { cn } from "@/lib/utils";
import { proxyUrl } from "@/lib/proxy-url";
import { cacheImage } from "@/lib/image-cache";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  fallback?: React.ReactNode;
  fetchPriority?: "high" | "low" | "auto";
  loading?: "eager" | "lazy";
  noShimmer?: boolean;
  /** Called after the internal retry also fails — lets the parent advance to a mirror URL. */
  onError?: () => void;
}

/**
 * Theme-aware "Image unavailable" placeholder — mirrors the SVG the media proxy
 * returns for upstream failures (media-proxy.ts FALLBACK_SVG). Uses the app's
 * `muted`/`muted-foreground` tokens so the placeholder follows the active
 * theme (dark in dark mode, light in light mode) instead of being hardcoded.
 */
export function ImageUnavailable({ initials, className }: { initials?: string; className?: string }) {
  return (
    <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground/40", className)}>
      <svg
        className="w-8 h-8"
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
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
          {initials}
        </span>
      ) : (
        <span className="text-[9px] font-medium tracking-wider uppercase text-muted-foreground/50">
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
  onError: onErrorProp,
}: OptimizedImageProps) {
  // Route the image through the media proxy unless it's local / already proxied.
  const resolvedSrc = proxyUrl(src) ?? src;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Warm the repeat-visit IDB cache (thumbnail = hot) so sprites/previews and
  // the SW can reuse it — but the <img> itself uses the real proxy URL, not a
  // blob URL. Blob URLs handed to a lazy-deferred <img> can be revoked by the
  // memory-cache cleanup before the deferred load paints, yielding a flood of
  // blob:ERR_FILE_NOT_FOUND during grid render. Browser HTTP cache + SW already
  // make repeat visits near-instant, so we skip the blob path for these cards.
  useEffect(() => {
    setLoaded(false);
    setError(false);
    setAttempt(0);
    cacheImage(resolvedSrc, 3).catch(() => {});
  }, [resolvedSrc]);

  const onLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  const onError = useCallback(() => {
    if (attempt === 0) {
      // One soft retry (e.g. a transient proxy failure) by re-keying the <img>
      // (fresh fetch) — but only when src hasn't changed under us.
      setAttempt((a) => a + 1);
      cacheImage(resolvedSrc, 3).catch(() => {});
      return;
    }
    setError(true);
    setLoaded(true);
    onErrorProp?.();
  }, [attempt, resolvedSrc, onErrorProp]);

  if (error) {
    return fallback ?? <DefaultFallback />;
  }

  return (
    <div className={cn("relative overflow-hidden bg-secondary", containerClassName)}>
      <img
        key={`${resolvedSrc}-${attempt}`}
        src={resolvedSrc}
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
