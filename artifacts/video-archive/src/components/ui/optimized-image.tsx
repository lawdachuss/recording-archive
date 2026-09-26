import { useState, useCallback, useEffect, useMemo, useRef, memo } from "react";
import { cn } from "@/lib/utils";
import { isConnectionConstrained, resolveImageWidth, type ThumbnailTier } from "@/lib/connection";
import { proxyImageUrl, isHttp2ResetHost, extractOriginalFromWsrv, markWsrvFailedForHost } from "@/lib/proxy-url";
import { acquireHostConcurrency, cacheImage } from "@/lib/image-cache";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  fallback?: React.ReactNode;
  fetchPriority?: "high" | "low" | "auto";
  loading?: "eager" | "lazy";
  noShimmer?: boolean;
  /**
   * Requested proxy width — a named tier (see THUMBNAIL_WIDTH) or explicit
   * pixels. Defaults to the "card" tier. Set this to match how large the image
   * is actually rendered: asking a 82px performer circle for 1200px costs ~14x
   * the bytes for no visible gain.
   */
  width?: ThumbnailTier | number;
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
 * Retry backoff for hosts whose shared HTTP/2 connection dies mid-flight
 * (ERR_HTTP2_PING_FAILED): the death kills EVERY queued request at once and an
 * immediate re-attempt rides the same dying connection (the duplicate error
 * pairs in the console) — so retries are DELAYED to wait out the teardown;
 * each attempt opens a fresh connection, which recovers. Three retries ≈ 12s
 * before the card finally gives up. A random ±700ms jitter is added per retry
 * (see onError) so a grid that failed together doesn't resynchronize into an
 * identical second burst. Non-flaky hosts keep the original fast single
 * retry — a definitive 404 shouldn't hold a placeholder for seconds.
 */
const FLAKY_H2_RETRY_DELAYS_MS = [1000, 3000, 8000];

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
  width,
  onError: onErrorProp,
}: OptimizedImageProps) {
  // Route the image through the media proxy with the adaptive-size + webp
  // transform unless it's local / already resized. The server compresses the
  // upstream to the requested width (and converts to webp) so thumbnails
  // download at a fraction of the full-res bytes. Idempotent: if `src` is
  // already a resized proxy URL it's kept as-is.
  const requestedWidth = resolveImageWidth(width);
  const resolvedSrc = proxyImageUrl(src, { width: requestedWidth }) ?? src;
  // When the proxy URL is wsrv.nl, remember the original so we can fall back
  // to loading directly if wsrv.nl is down (returns 404).
  const directSrc = extractOriginalFromWsrv(resolvedSrc);
  // Is the image hosted on an HTTP/2-flaky host (catbox family)? Those get
  // DELAYED retries (see FLAKY_H2_RETRY_DELAYS_MS) instead of one instant one.
  const flakyH2 = useMemo(() => {
    try {
      return isHttp2ResetHost(new URL(resolvedSrc, window.location.origin).hostname);
    } catch {
      return false;
    }
  }, [resolvedSrc]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Pending delayed-retry timer — cleared on unmount / src change so a retry
  // can never fire against a stale element.
  const retryTimerRef = useRef<number | null>(null);
  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);
  // Whether the element is near the viewport. Below-fold lazy images keep a
  // blank src until an IntersectionObserver flips this — otherwise a 40-card
  // grid fires ~30 network requests at once on first paint and they serialize
  // against the host (catbox throttling made the first row wait 4-13s).
  const [inView, setInView] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Flaky-H2 host admission (catbox & friends). The cache warmers are capped
  // at 2 concurrent requests per host (image-cache hostConcurrency — catbox's
  // high-speed band), but <img> elements load OUTSIDE that pipeline: a grid of
  // ~26 eager thumbnails firing at once trips catbox's HTTP/2 reset storm (the
  // mass ERR_HTTP2_PROTOCOL_ERROR lines), and every failed element retrying on
  // the SAME fixed backoff then resynchronizes into a second identical burst
  // (the duplicate error waves). So a flaky-host element must HOLD one of the
  // SAME host slots before it may assign src, and release it when the image
  // settles — element loads and warm fetches together can then never exceed
  // the host cap. Queued FIFO (priority default) → mount order, top row first.
  // Non-flaky hosts keep direct, uncapped loads (slotHeld stays irrelevant).
  const [slotHeld, setSlotHeld] = useState(!flakyH2);
  const slotReleaseRef = useRef<(() => void) | null>(null);
  const slotWatchdogRef = useRef<number | null>(null);
  /** Return the held host slot (idempotent — safe from load, error, cleanup, watchdog). */
  const releaseSlot = useCallback(() => {
    if (slotWatchdogRef.current !== null) {
      window.clearTimeout(slotWatchdogRef.current);
      slotWatchdogRef.current = null;
    }
    const rel = slotReleaseRef.current;
    slotReleaseRef.current = null;
    rel?.();
  }, []);

  // Reset state when the src changes (also cancels any pending delayed retry).
  useEffect(() => {
    setLoaded(false);
    setError(false);
    setAttempt(0);
    return clearRetryTimer;
  }, [resolvedSrc, clearRetryTimer]);

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

  // Admission for flaky-H2 hosts: acquire a host slot BEFORE src may render.
  // Re-runs on src change / retry attempt, so every REQUEST re-acquires; the
  // cleanup releases (idempotent) so remounts and unmounts can't leak slots.
  useEffect(() => {
    if (!flakyH2 || !inView || !resolvedSrc) return;
    let host: string;
    try {
      host = new URL(resolvedSrc, window.location.origin).hostname;
    } catch {
      setSlotHeld(true); // unparseable (flakyH2 would be false anyway) — fail open
      return;
    }
    let cancelled = false;
    acquireHostConcurrency(host)
      .then((release) => {
        if (cancelled) {
          release();
          return;
        }
        slotReleaseRef.current = release;
        setSlotHeld(true);
        // Watchdog: a hung stream must not hold one of the host's only two
        // slots forever — after 30s free it (the request itself keeps running;
        // the normal load/error path still releases idempotently).
        slotWatchdogRef.current = window.setTimeout(() => {
          const rel = slotReleaseRef.current;
          slotReleaseRef.current = null;
          rel?.();
        }, 30_000);
      })
      .catch(() => {
        // Fail open: better an uncapped load than a permanently hidden image.
        if (!cancelled) setSlotHeld(true);
      });
    return () => {
      cancelled = true;
      releaseSlot();
      setSlotHeld(false);
    };
  }, [flakyH2, inView, resolvedSrc, attempt, releaseSlot]);

  const onLoad = useCallback(() => {
    setLoaded(true);
    // Bytes arrived — return the host slot to the pool. The gate stays open
    // and src keeps rendering; only the admission slot is handed back.
    releaseSlot();
    // Cache the URL that actually loaded into IDB so repeat visits skip the
    // network. When wsrv 404'd and we fell back to directSrc (attempt≥1), cache
    // directSrc — NOT resolvedSrc (which would retry the broken wsrv URL again).
    const urlToCache = (attempt >= 1 && directSrc) ? directSrc : resolvedSrc;
    cacheImage(urlToCache, 3).catch(() => {});
  }, [resolvedSrc, directSrc, attempt, releaseSlot]);

  const onError = useCallback(() => {
    if (directSrc && attempt === 0) {
      // wsrv proxy failed (e.g. 404/DNS). Mark the host in circuit-breaker so
      // subsequent cards immediately use directSrc instead of failing wsrv.
      markWsrvFailedForHost(directSrc);
      // Immediately switch to direct URL on attempt 1! Do NOT retry the failed wsrv URL!
      setAttempt(1);
      return;
    }
    if (flakyH2) {
      // Return the host slot and close the admission gate for the backoff
      // window — the next attempt re-acquires a slot before re-requesting.
      // JITTER: when a whole grid fails together, a fixed delay would
      // resynchronize every retry into a second identical burst (the
      // duplicate error waves in the console), so spread attempts over an
      // extra ±700ms. Otherwise: schedule the next attempt AFTER the backoff
      // so it rides a fresh HTTP/2 connection instead of the dying one. The
      // shimmer keeps covering the dead <img> until the retry fires.
      releaseSlot();
      setSlotHeld(false);
      const delay = FLAKY_H2_RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 700);
      if (FLAKY_H2_RETRY_DELAYS_MS[attempt] !== undefined) {
        clearRetryTimer();
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setAttempt((a) => a + 1);
        }, delay);
        return;
      }
      // Backoff budget exhausted — give up like any other host.
      setError(true);
      setLoaded(true);
      onErrorProp?.();
      return;
    }
    if (attempt === 0) {
      // One soft retry for non-wsrv URLs
      setAttempt(1);
    } else {
      setError(true);
      setLoaded(true);
      onErrorProp?.();
    }
  }, [attempt, directSrc, flakyH2, clearRetryTimer, releaseSlot, onErrorProp]);

  if (error) {
    return fallback ?? <DefaultFallback />;
  }

  const actualSrc = inView && (!flakyH2 || slotHeld) ? (attempt >= 1 && directSrc ? directSrc : resolvedSrc) : undefined;
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
        loading={loading ?? "eager"}
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
