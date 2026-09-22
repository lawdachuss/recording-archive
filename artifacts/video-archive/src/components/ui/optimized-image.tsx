import { useState, useCallback, useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";
import { isConnectionConstrained } from "@/lib/connection";
import { proxyImageUrl, isHttp2ResetHost, extractOriginalFromWsrv, markWsrvFailedForHost } from "@/lib/proxy-url";
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

/**
 * Hosts that send `Access-Control-Allow-Origin` — the only cross-origin hosts
 * where a CORS-mode <img> (crossOrigin="anonymous") is safe AND useful (the
 * response lands in the CORS HTTP-cache bucket, shared with the CORS-mode
 * preload/cacheImage fetches).
 */
const CORS_HOSTS = ["catbox.moe", "litter.catbox.moe", "files.catbox.moe"];

/**
 * True when an <img> may load `url` in CORS mode without being blocked.
 * Same-origin URLs (relative /api/media proxy) are always readable; catbox
 * family sends ACAO. Everything else (iili.io, freeimage.host, imgchest, ...)
 * does NOT send CORS headers — a crossOrigin="anonymous" <img> there is
 * blocked outright ("Access to image ... blocked by CORS policy"), so those
 * must load as plain images.
 */
function canLoadInCorsMode(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin === window.location.origin) return true;
    const hostname = parsed.hostname.toLowerCase();
    return CORS_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
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
  // Route the image through the media proxy with the adaptive-size + webp
  // transform unless it's local / already resized. The server compresses the
  // upstream to the measured tier width (400/800/1200) so thumbnails download
  // at a fraction of the full-res bytes — the biggest first-paint win on slow
  // links. Idempotent: if `src` is already a resized proxy URL it's kept as-is.
  const resolvedSrc = proxyImageUrl(src) ?? src;
  // When the proxy URL is wsrv.nl, remember the original so we can fall back
  // to loading directly if wsrv.nl is down (returns 404).
  const directSrc = extractOriginalFromWsrv(resolvedSrc);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Whether the element is near the viewport. Below-fold lazy images keep a
  // blank src until an IntersectionObserver flips this — otherwise a 40-card
  // grid fires ~30 network requests at once on first paint and they serialize
  // against the host (catbox throttling made the first row wait 4-13s).
  const [inView, setInView] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset state when the src changes.
  useEffect(() => {
    setLoaded(false);
    setError(false);
    setAttempt(0);
  }, [resolvedSrc]);

  // Below-fold lazy images wait for near-viewport intersection before fetching.
  useEffect(() => {
    if (isConnectionConstrained()) {
      const el = containerRef.current;
      if (!el || typeof IntersectionObserver === "undefined") {
        setInView(true);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setInView(true);
            io.disconnect();
          }
        },
        { rootMargin: "1500px 0px" },
      );
      io.observe(el);
      return () => io.disconnect();
    }
    setInView(true);
    return;
  }, [loading, resolvedSrc]);

  const onLoad = useCallback(() => {
    setLoaded(true);
    // Persist to IDB (thumbnail = hot, evict last) so repeat visits skip the
    // network entirely.
    cacheImage(resolvedSrc, 3).catch(() => {});
  }, [resolvedSrc]);

  const onError = useCallback(() => {
    if (directSrc && attempt === 0) {
      // wsrv proxy failed (e.g. 404/DNS). Mark the host in circuit-breaker so
      // subsequent cards immediately use directSrc instead of failing wsrv.
      markWsrvFailedForHost(directSrc);
      // Immediately switch to direct URL on attempt 1! Do NOT retry the failed wsrv URL!
      setAttempt(1);
    } else if (attempt === 0) {
      // One soft retry for non-wsrv URLs
      setAttempt(1);
    } else {
      setError(true);
      setLoaded(true);
      onErrorProp?.();
    }
  }, [attempt, directSrc, onErrorProp]);

  if (error) {
    return fallback ?? <DefaultFallback />;
  }

  const actualSrc = inView ? (attempt >= 1 && directSrc ? directSrc : resolvedSrc) : undefined;
  const corsMode = actualSrc ? canLoadInCorsMode(actualSrc) : false;

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden bg-secondary", containerClassName)}
    >
      <img
        key={`${resolvedSrc}-${attempt}`}
        src={actualSrc}
        alt={alt}
        referrerPolicy="no-referrer"
        loading={loading ?? (fetchPriority === "high" ? "eager" : "lazy")}
        decoding="async"
        fetchPriority={fetchPriority}
        onLoad={onLoad}
        onError={onError}
        className={cn("absolute inset-0 w-full h-full object-cover", className)}
        crossOrigin={corsMode ? "anonymous" : undefined}
      />
      {!loaded && !noShimmer && (
        <div className="absolute inset-0 z-10 bg-secondary">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_0.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      )}
    </div>
  );
});
