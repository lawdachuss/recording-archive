import { useState, useCallback, useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";
import { isConnectionConstrained } from "@/lib/connection";
import { proxyImageUrl, isHttp2ResetHost } from "@/lib/proxy-url";
import { cacheImage } from "@/lib/image-cache";
import { recordImageLoad } from "@/lib/adaptive-quality";

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
 * Extract the original upstream URL from a wsrv.nl (images.weserv.nl) proxy URL.
 * wsrv.nl format: https://images.weserv.nl/?url=<encoded>&w=400&output=webp
 * Returns null if the URL is not a wsrv.nl proxy URL.
 */
function extractOriginalFromWsrv(proxiedUrl: string): string | null {
  try {
    const parsed = new URL(proxiedUrl);
    if (!parsed.hostname.endsWith("weserv.nl")) return null;
    const inner = parsed.searchParams.get("url");
    return inner || null;
  } catch {
    return null;
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
  // When the <img> element started fetching — feeds the adaptive-speed
  // measurement (median thumbnail load time auto-tunes the connection tier
  // that gates hover previews / preloads / sprite animation on slow links).
  // Set via ref callback so retries (attempt re-key) get fresh timestamps.
  const loadStartRef = useRef<number | null>(null);

  // Reset state when the src changes. Note: we deliberately do NOT warm the
  // IDB cache here on mount — the <img> below is already fetching this exact
  // URL, so a parallel cacheImage() would issue a SECOND network request for
  // every cold grid render and double first-paint bandwidth. The <img> itself
  // uses the real proxy URL (not a blob URL — blob URLs handed to a
  // lazy-deferred <img> can be revoked by memory-cache cleanup before the
  // deferred load paints, yielding blob:ERR_FILE_NOT_FOUND floods). Browser
  // HTTP cache + SW make repeat visits near-instant; IDB is warmed in onLoad
  // once the bytes are already in the HTTP cache (free, force-cache hit).
  useEffect(() => {
    setLoaded(false);
    setError(false);
    setAttempt(0);
  }, [resolvedSrc]);

  // Timestamp the moment a deferred image actually starts fetching (right
  // after `inView` assigns a src) so the adaptive-speed sample measures real
  // perceived load time — the ref callback alone can't catch deferred images
  // because React updates src on a mounted <img> without re-running its ref.
  useEffect(() => {
    if (inView) loadStartRef.current = performance.now();
  }, [inView, resolvedSrc, attempt]);

  // Below-fold lazy images wait for near-viewport intersection before fetching.
  // The window is taller than the first couple of grid rows, so a generous
  // rootMargin (~1.5 viewport heights) starts the fetch while still spacing out
  // the burst of requests a full grid would otherwise fire simultaneously.
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
    // network entirely. Cheap: cacheImage's force-cache fetch resolves from
    // the HTTP cache this <img> just populated — no extra bytes downloaded.
    cacheImage(resolvedSrc, 3).catch(() => {});
    // Feed the adaptive-speed measurement: how long this thumbnail really
    // took to arrive on THIS network, right now. The median of these samples
    // drives the slow-connection tier (≥2s → constrained), so even browsers
    // without the Network Information API (Safari) get automatic adaptation.
    if (loadStartRef.current != null) {
      recordImageLoad(performance.now() - loadStartRef.current);
    }
  }, [resolvedSrc]);

  const onError = useCallback(() => {
    if (attempt === 0) {
      // One soft retry (e.g. a transient proxy failure) by re-keying the <img>
      // (fresh fetch) — but only when src hasn't changed under us. The
      // retried <img>'s onLoad warms IDB if it succeeds.
      setAttempt((a) => a + 1);
    } else if (directSrc && attempt === 1) {
      // If this was a wsrv.nl proxy URL and we haven't tried the direct URL yet,
      // fall back to loading the original URL directly from the browser.
      // This handles wsrv.nl outages — catbox etc. can often be reached directly.
      setAttempt((a) => a + 1);
    } else {
      setError(true);
      setLoaded(true);
      onErrorProp?.();
    }
  }, [attempt, resolvedSrc, directSrc, onErrorProp]);

  if (error) {
    return fallback ?? <DefaultFallback />;
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden bg-secondary", containerClassName)}
    >
      <img
        key={`${resolvedSrc}-${attempt}`}
        src={inView ? (attempt >= 2 && directSrc ? directSrc : resolvedSrc) : undefined}
        alt={alt}
        referrerPolicy="no-referrer"
        loading={loading ?? (fetchPriority === "high" ? "eager" : "lazy")}
        decoding="async"
        fetchPriority={fetchPriority}
        onLoad={onLoad}
        onError={onError}
        className={cn("absolute inset-0 w-full h-full object-cover", className)}
        crossOrigin="anonymous"
      />
      {!loaded && !noShimmer && (
        <div className="absolute inset-0 z-10 bg-secondary">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_0.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      )}
    </div>
  );
});
