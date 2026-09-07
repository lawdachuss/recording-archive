import { useMemo, useState, useEffect, useCallback, useRef, memo } from "react";
import { Link } from "wouter";
import type { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime, formatViewers, formatDuration } from "@/lib/formatters";
import { Eye, HardDrive, Clock, CheckCircle } from "lucide-react";
import { OptimizedImage, ImageUnavailable } from "@/components/ui/optimized-image";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { useProgressiveImage } from "@/hooks/use-progressive-image";
import { useCachedMediaSrc } from "@/hooks/use-cached-media-src";
import { useConnectionConstrained } from "@/hooks/use-connection-quality";
import { SpriteSlideshow } from "@/components/SpriteSlideshow";
import { cn } from "@/lib/utils";
import { proxyUrl, proxySpriteUrl, catboxProxyUrl } from "@/lib/proxy-url";
import { getSpriteGrid } from "@/lib/sprite-grid";
import { buildPreviewFallbacks, buildThumbnailFallbacks, buildSpriteFallbacks } from "@/lib/mirrors";
import { dlog } from "@/lib/debug";

/**
 * Unwrap a media-proxy URL to extract the real upstream URL for
 * extension-based type detection.
 */
function getOriginalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith("/api/media")) {
      const inner = parsed.searchParams.get("url");
      if (inner) return inner;
    }
    // wsrv.nl re-encodes media under its own origin (`/?url=<encoded>`).
    // Unwrap so extension-based type detection still works.
    if (parsed.hostname.endsWith("wsrv.nl")) {
      const inner = parsed.searchParams.get("url");
      if (inner) return inner;
    }
  } catch {}
  return url;
}

/**
 * Get the file extension from a URL's pathname (ignores query params).
 * Returns lowercase extension with dot, e.g. ".webp", or "" if none.
 */
function getExt(url: string): string {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const dot = pathname.lastIndexOf(".");
    return dot >= 0 ? pathname.slice(dot).toLowerCase() : "";
  } catch {
    const q = url.split("?")[0];
    const dot = q.lastIndexOf(".");
    return dot >= 0 ? q.slice(dot).toLowerCase() : "";
  }
}

/**
 * Hosts whose animated previews are empirically unreliable/expired (iili.io /
 * freeimage.host return 403 for older uploads). They are excluded from the
 * hover preview fallback chain — the looping sprite sheet is already layered
 * underneath and carries the hover animation, while iili.io STATIC thumbnails
 * (.md.jpg) are still kept for the thumbnail path (those still serve 200).
 */
const UNRELIABLE_PREVIEW_HOSTS = ["iili.io", "freeimage.host"];

function isUnreliablePreviewHost(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url, window.location.origin).hostname;
    return UNRELIABLE_PREVIEW_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`)
    );
  } catch {
    return false;
  }
}

/**
 * True when a URL is a STATIC single-frame thumbnail. These carry a `.th.webp`
 * or `_thumb.` marker (iili.io / freeimage.host). They never animate, so they
 * are skipped in favour of the looping sprite. Everything else that looks like
 * an image (`.webp`, and the misleadingly-named `.mp4_preview` which is really
 * animated WEBP content) is treated as genuinely animated.
 */
function isStaticThumbnailUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.th\.webp$/i.test(url) || /[_-]thumb\./i.test(url);
}

/**
 * True when the URL is an animated image — `.webp`, or `.mp4_preview` which is
 * actually WEBP content served with a misleading extension (observed on catbox).
 */
function isAnimatedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const ext = getExt(url);
  return ext === ".webp" || ext === ".mp4_preview" || /\.mp4_preview$/i.test(url);
}

// If a hover preview hasn't produced its first frame within this window,
// treat the source as unreachable and fall back (files.catbox.moe consistently
// times out for minutes on this network; the browser would otherwise leave the
// request hanging and never engage the sprite/static fallback).
const PREVIEW_TIMEOUT_MS = 3000;

interface VideoCardProps {
  recording: Recording;
  showRemove?: boolean;
  onRemove?: () => void;
  fetchPriority?: "high" | "low" | "auto";
  isWatched?: boolean;
  /** 0-100 completion percentage. Shows progress bar when > 0 and < 100. */
  progress?: number;
}

export const VideoCard = memo(function VideoCard({ recording, showRemove, onRemove, fetchPriority, isWatched, progress }: VideoCardProps) {
  // Build mirror fallback URLs for preview, thumbnail, and sprite
  const previewFallbacks = useMemo(() => buildPreviewFallbacks(recording), [recording.preview_url, recording.preview_mirrors]);
  const thumbnailFallbacks = useMemo(() => buildThumbnailFallbacks(recording), [recording.thumbnail_url, recording.thumbnail_mirrors]);
  const spriteFallbacks = useMemo(() => buildSpriteFallbacks(recording), [recording.sprite_url, recording.sprite_mirrors]);

  // Filter preview fallbacks to only .webp / .mp4_preview URLs (animated images).
  // If a .webp preview exists — even from a mirror — show it on hover.
  // If no .webp exists, skip preview entirely and let sprites handle hover.
  // iili.io / freeimage.host .webp previews are excluded: they are the least
  // reliable host and older uploads are expired (403), which would otherwise
  // spawn a useless network request on every hover. The sprite covers those.
  const webpFallbacks = useMemo(() => {
    return previewFallbacks.filter(url => {
      const original = getOriginalUrl(url) ?? url;
      return isAnimatedImageUrl(original) && !isStaticThumbnailUrl(original) && !isUnreliablePreviewHost(original);
    });
  }, [previewFallbacks]);

  // Mirror fallback state - track which fallback we're currently trying
  const [previewIndex, setPreviewIndex] = useState(0);
  const [thumbnailIndex, setThumbnailIndex] = useState(0);
  const [spriteIndex, setSpriteIndex] = useState(0);

  const thumbnailUrl = useMemo(() => thumbnailFallbacks[thumbnailIndex] ? proxyUrl(thumbnailFallbacks[thumbnailIndex]) : null, [thumbnailFallbacks, thumbnailIndex]);
  // Use .webp preview if available (including mirrors); null means no animated preview exists.
  const previewUrl = useMemo(() => {
    if (webpFallbacks.length === 0) return null;
    return proxyUrl(webpFallbacks[Math.min(previewIndex, webpFallbacks.length - 1)]);
  }, [webpFallbacks, previewIndex]);
  const spriteUrl = useMemo(() => spriteFallbacks[spriteIndex] ? proxySpriteUrl(spriteFallbacks[spriteIndex]) : null, [spriteFallbacks, spriteIndex]);
  const spriteGrid = useMemo(() => getSpriteGrid(spriteFallbacks[spriteIndex] || null), [spriteFallbacks, spriteIndex]);

  // On constrained connections we downgrade the hover preview to the cheap
  // sprite sheet only (no multi-MB video/webp overlay), so hovering ALWAYS
  // gives instant visual feedback without saturating a slow link. This uses
  // the shared detector (Network Information API + Data Saver + measured
  // thumbnail speed) and re-evaluates LIVE as the connection quality,
  // measured speed, or Data Saver toggle changes.
  const isSlowConnection = useConnectionConstrained();

  const {
    isHovered,
    showVideo,
    showAnimatedImage,
    videoUrl,
    animatedImageUrl,
    hoverHandlers,
    viewportRef,
    preloadVideoUrl,
  } = useHoverPreview({ thumbnailUrl, previewUrl, spriteUrl });

  const staticImage = thumbnailUrl;
  const hasStaticImage = !!staticImage;
  const initials = useMemo(() => recording.username?.slice(0, 2).toUpperCase() ?? "??", [recording.username]);

  // Resolve the hover video to its IDB-cached blob when already warmed (by
  // preloadVideo), so hover playback starts instantly with zero re-fetch.
  const previewVideoSrc = useCachedMediaSrc(videoUrl);

  const showPreview = isHovered && (showVideo || showAnimatedImage);

  // Preview playback with mirror fallback: the primary preview URL is tried
  // first; on error we advance to the next mirror host (sprite stays underneath
  // as the guaranteed animation). Static .th.webp thumbnails are skipped.
  const [mediaFail, setMediaFail] = useState<"none" | "video" | "all">("none");
  // The preview is only swapped over the thumbnail once it actually has frames
  // (`onLoadedData`) — until then the thumbnail stays visible with a loading
  // bar, so hovering never flashes a black box.
  const [previewReady, setPreviewReady] = useState(false);
  useEffect(() => {
    setMediaFail("none");
    setPreviewReady(false);
  }, [previewUrl]);

  // The hover <video> unmounts when the pointer leaves, so re-entering must
  // go through the ready gate again (loading bar over thumbnail, never black).
  // Also reset mediaFail so the preview retry works on re-hover.
  useEffect(() => {
    if (!isHovered) {
      setMediaFail("none");
      setPreviewReady(false);
    }
  }, [isHovered]);

  // Sprite fallback image load state — the thumbnail stays visible until the
  // sprite sheet has actually painted, and is restored if it fails.
  const [spriteReady, setSpriteReady] = useState(false);
  const [spriteFailed, setSpriteFailed] = useState(false);
  useEffect(() => {
    setSpriteReady(false);
    setSpriteFailed(false);
  }, [spriteUrl]);

  // Reset sprite states when hover ends. Keeping spriteReady=true across
  // hovers caused a black flash: hideStatic became true immediately on
  // re-enter, hiding the thumbnail before SpriteSlideshow had painted its
  // background-image — exposing the dark bg-secondary behind it.
  useEffect(() => {
    if (!isHovered) {
      setSpriteReady(false);
      setSpriteFailed(false);
    }
  }, [isHovered]);

  // Stable callbacks so SpriteSlideshow (memo) doesn't re-render on every
  // VideoCard render, which would restart its animation via a changing prop.
  const handleSpriteLoaded = useCallback(() => setSpriteReady(true), []);
  const handleSpriteError = useCallback(() => {
    if (spriteIndex + 1 < spriteFallbacks.length) {
      setSpriteFailed(false);
      setSpriteReady(false);
      setSpriteIndex(i => i + 1);
    } else {
      setSpriteFailed(true);
    }
  }, [spriteIndex, spriteFallbacks.length]);

  // NOTE: no mount-time preview warming here. An eager cacheImage() on mount
  // downloaded a full preview per card (unbounded by the preload cap) and
  // competed with grid paint — the very problem the catalog-warmer taming
  // removed. Preview bytes arrive via the viewport preload (capped to 3
  // concurrent) and the hover-time progressive stream, both of which also
  // warm IDB.

  // `canplay`/`loadeddata` fire as soon as bytes are buffered, which can be
  // well before the first frame is actually painted to the screen. Flipping
  // `previewReady` then hides the thumbnail and exposes the near-black
  // `bg-secondary` behind it. Wait for the first presented frame via
  // requestVideoFrameCallback (falling back to `canplay`) so the thumbnail
  // stays until the preview genuinely has a frame to show.
  const onPreviewReady = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    const rvfc = (
      v as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }
    ).requestVideoFrameCallback;
    if (typeof rvfc === "function") {
      try {
        rvfc.call(v, () => setPreviewReady(true));
        return;
      } catch {
        /* fall through to the eager path */
      }
    }
    setPreviewReady(true);
  }, []);

  const spriteAvailable = !!spriteUrl;
  const previewAvailable = !!previewUrl;

  // Sprite is ALWAYS the instant hover effect — it appears immediately when
  // the pointer enters. The preview video/image loads on top as a bonus if
  // it's available and hasn't failed. This gives instant visual feedback
  // instead of waiting 6s for a slow catbox preview to time out.
  const usePreviewChain = previewAvailable && mediaFail !== "all";
  const useSprite = spriteAvailable && !spriteFailed;

  // Determine the current preview's real upstream URL (unwrapped) for accurate
  // type detection across mirror fallbacks (each host may use a different ext).
  const originalPreviewUrl = getOriginalUrl(previewUrl) ?? previewUrl;
  const isCatboxPreview = /catbox\.moe/i.test(originalPreviewUrl ?? "");
  const isStaticThumb = isStaticThumbnailUrl(originalPreviewUrl);
  // Animated image: .webp OR .mp4_preview (misleadingly-named, actually WEBP).
  const isAnimatedImg = isAnimatedImageUrl(originalPreviewUrl);
  const previewExt = getExt(originalPreviewUrl ?? "");
  // Only true for genuine video previews (mp4/webm/mov), never .webp/.mp4_preview.
  const isRealVideo = previewExt === ".mp4" || previewExt === ".webm" || previewExt === ".mov";

  // catbox animated images must route through the Cloudflare Worker (catbox is
  // unreachable from the browser / Vercel). Non-catbox animated webp (pixhost)
  // loads through the normal /api/media proxy.
  const catboxWorkerUrl =
    isCatboxPreview && isAnimatedImg && !isStaticThumb ? catboxProxyUrl(originalPreviewUrl) : null;

  // Static thumbnails (.th.webp) never animate — the looping sprite provides the
  // hover animation, so skip them entirely. Animated images show as <img> (catbox
  // via Worker). Genuine videos show as <video>.
  // On constrained connections the heavy video/webp overlay is skipped entirely
  // so only the cheap sprite sheet renders on hover — the sprite image is
  // already-cached and animating it costs no extra bandwidth.
  const heavyPreviewEnabled = !isSlowConnection;
  const showCatboxWebpImg = !!catboxWorkerUrl && heavyPreviewEnabled && usePreviewChain && showAnimatedImage && mediaFail === "none";
  const showWebpImg = heavyPreviewEnabled && isAnimatedImg && !isStaticThumb && !isCatboxPreview && usePreviewChain && showAnimatedImage && mediaFail === "none";
  const showVideoEl = heavyPreviewEnabled && isRealVideo && usePreviewChain && showVideo && mediaFail === "none";
  const showImgFallback = heavyPreviewEnabled && isRealVideo && usePreviewChain && showAnimatedImage && mediaFail === "video";

  const showSprite = isHovered && useSprite;

  // ── Real-time hover progress ────────────────────────────────────────────
  // The sprite sheet is streamed through useProgressiveImage, which reports
  // byte-level download progress (or an instant blob URL when cached). Real
  // video previews report buffered/duration progress via the <video> element.
  // Together they drive a thin progress bar so the user sees the hover media
  // actually loading instead of an indeterminate shimmer.
  const spriteProgressive = useProgressiveImage(spriteUrl, showSprite);
  // The animated-webp preview is streamed the same way as the sprite — an
  // <img> exposes no download progress, so without this the bar would sit
  // idle while the (often slowest) preview downloads on top of an already-warm
  // sprite. Streams BOTH the proxied pixhost webp AND catbox webp (loaded
  // directly from the browser with CORS); on any stream failure the hook falls
  // back to the original URL and the <img> error/fallback chain takes over.
  const showAnyWebpImg = showWebpImg || showCatboxWebpImg;
  const previewProgressive = useProgressiveImage(
    showAnyWebpImg ? animatedImageUrl : null,
    showAnyWebpImg,
  );
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  useEffect(() => {
    setVideoProgress(null);
  }, [previewUrl]);
  useEffect(() => {
    if (!isHovered) setVideoProgress(null);
  }, [isHovered]);
  // A failed <video> may have left a stale buffered % — drop it so the bar
  // doesn't sit on a misleading value while the mirror fallback loads.
  useEffect(() => {
    setVideoProgress(null);
  }, [mediaFail]);

  const hoverProgress: number | null =
    spriteProgressive.progress !== null ||
    videoProgress !== null ||
    previewProgressive.progress !== null
      ? Math.min(
          99,
          Math.max(
            spriteProgressive.progress ?? 0,
            videoProgress ?? 0,
            previewProgressive.progress ?? 0,
          ),
        )
      : null;

  // Still loading: the user is hovering and something is downloading but
  // nothing has painted yet — the sprite, or the preview media. Once either
  // paints (sprite ready) the bar keeps reporting the preview's own progress
  // until its first frame is shown.
  const showLoadingBar =
    isHovered &&
    !previewReady &&
    ((useSprite && !spriteReady) || (usePreviewChain && !previewReady));

  // Debug: log which preview branch is currently active so we can correlate
  // with the on-hover behavior (sprite / webp img / video / fallbacks).
  useEffect(() => {
    dlog("hoverpreview", "[VideoCard] branch", {
      id: recording.id,
      isHovered,
      previewUrl,
      spriteUrl,
      isCatbox: isCatboxPreview,
      isStaticThumb,
      isAnimatedImg,
      previewExt,
      catboxWorkerUrl,
      mediaFail,
      previewReady,
      spriteReady,
      showSprite,
      showWebpImg,
      showVideoEl,
      showImgFallback,
      showLoadingBar,
      usePreviewChain,
      useSprite,
    });
  }, [
    isHovered, previewUrl, spriteUrl, isCatboxPreview, isStaticThumb, isAnimatedImg, previewExt, catboxWorkerUrl, mediaFail,
    previewReady, spriteReady, showSprite, showWebpImg,
    showVideoEl, showImgFallback, showLoadingBar, usePreviewChain, useSprite,
    recording.id,
  ]);


  // Debug: log mediaFail / previewReady transitions explicitly (element errors,
  // timeouts, first painted frame) to pinpoint where the preview breaks.
  useEffect(() => {
    dlog("hoverpreview", "[VideoCard] media state", {
      id: recording.id,
      mediaFail,
      previewReady,
      spriteReady,
    });
  }, [mediaFail, previewReady, spriteReady, recording.id]);

  // Fail-fast timer: unmount the hanging <video> / <img> after the timeout and
  // mark the preview failed, so the sprite/static fallback engages in seconds
  // instead of the browser's multi-minute connection timeout.
  // For streamed webp previews this only applies while NOTHING has arrived yet
  // (progress null — e.g. waiting on first bytes or a stuck native fallback
  // <img>). A stream that is actively delivering bytes keeps its slot until the
  // stall watchdog in useProgressiveImage fires instead.
  const webpStuck =
    (showWebpImg || showCatboxWebpImg) && previewProgressive.progress === null;
  useEffect(() => {
    if (!(showVideoEl || showImgFallback || webpStuck) || previewReady) {
      return;
    }
    const t = setTimeout(() => setMediaFail("all"), PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [showVideoEl, showImgFallback, webpStuck, previewReady]);

  const showDuration = (recording.duration ?? 0) > 0;
  const showFilesize = !!recording.filesize && !showDuration;
  const showViewers = recording.viewers != null;

  return (
    <Link
      href={`/video/${recording.id}`}
      className="group block outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
      {...hoverHandlers}
    >
      <div ref={viewportRef} className="flex flex-col gap-2">
        <div className="relative aspect-video overflow-hidden bg-secondary rounded-sm will-change-transform">

          {/* Hidden preload video — warms the HTTP cache for instant hover
              playback. Only for actual video files (.mp4 etc.), NOT for .webp
              images (loading a .webp into <video> wastes a connection slot). */}
          {usePreviewChain && preloadVideoUrl && !isSlowConnection && isRealVideo && (
            <video
              src={preloadVideoUrl}
              className="hidden"
              muted playsInline preload="metadata"
              aria-hidden
              ref={(el) => {
                if (el) (el as HTMLVideoElement & { referrerPolicy?: string }).referrerPolicy = "no-referrer";
              }}
            />
          )}

          {/* Layer 1: Static thumbnail or initials fallback — always visible,
              provides the base image underneath sprite/preview layers. */}
          {hasStaticImage ? (
            <div className="absolute inset-0 w-full h-full">
              <OptimizedImage
                src={staticImage!}
                alt={recording.username}
                fetchPriority={fetchPriority}
                loading={fetchPriority === "high" ? "eager" : "lazy"}
                className="opacity-100"
                containerClassName="absolute inset-0 w-full h-full"
                fallback={<ImageUnavailable initials={initials} />}
                noShimmer
                onError={() => {
                  if (thumbnailIndex + 1 < thumbnailFallbacks.length) {
                    setThumbnailIndex((i) => i + 1);
                  }
                }}
              />
            </div>
          ) : (
            <ImageUnavailable initials={initials} />
          )}

          {/* Layer 2: Sprite sheet — instant hover preview, fades in smoothly
              on top of the thumbnail. The sprite is streamed through
              useProgressiveImage: a blob URL once its bytes are here (so the
              browser never double-fetches), or the original URL when streaming
              isn't possible and the native load + fallback chain takes over. */}
          {showSprite && spriteProgressive.src && (
            <SpriteSlideshow
              spriteUrl={spriteProgressive.src}
              cols={spriteGrid?.cols}
              rows={spriteGrid?.rows}
              className="absolute inset-0 w-full h-full transition-opacity duration-300"
              active={showSprite}
              onLoaded={handleSpriteLoaded}
              onError={handleSpriteError}
            />
          )}

          {/* Layer 3: Preview video/image — loads on top of sprite when
              available. Static thumbnails (.th.webp) are skipped; animated
              webp (catbox via Worker, pixhost via proxy) and real videos load
              here. */}
          {showWebpImg && previewProgressive.src && (
            <img
              src={previewProgressive.src}
              alt={recording.username}
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
              style={{ opacity: previewReady ? 1 : 0 }}
              onLoad={() => setPreviewReady(true)}
              onError={() => {
                if (previewIndex + 1 < webpFallbacks.length) {
                  setMediaFail("none");
                  setPreviewReady(false);
                  setPreviewIndex((i) => i + 1);
                } else {
                  setMediaFail("all");
                }
              }}
            />
          )}
          {showCatboxWebpImg && previewProgressive.src && (
            <img
              src={previewProgressive.src}
              alt={recording.username}
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
              style={{ opacity: previewReady ? 1 : 0 }}
              onLoad={() => {
                dlog("hoverpreview", "[VideoCard] catbox webp loaded", { id: recording.id, src: previewProgressive.src });
                setPreviewReady(true);
              }}
              onError={() => {
                dlog("hoverpreview", "[VideoCard] catbox webp failed, trying next fallback", { id: recording.id, index: previewIndex });
                if (previewIndex + 1 < webpFallbacks.length) {
                  setMediaFail("none");
                  setPreviewReady(false);
                  setPreviewIndex(i => i + 1);
                } else {
                  setMediaFail("all");
                }
              }}
            />
          )}
          {showVideoEl && previewVideoSrc && (
            <video
              src={previewVideoSrc}
              poster={hasStaticImage ? staticImage! : undefined}
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                previewReady ? "opacity-100" : "opacity-0"
              )}
              autoPlay muted playsInline loop
              preload="auto"
              onProgress={(e) => {
                // Real-time buffered progress (bytes on disk vs duration).
                const v = e.currentTarget;
                if (v.buffered.length > 0 && v.duration > 0 && isFinite(v.duration)) {
                  const pct = Math.min(
                    99,
                    (v.buffered.end(v.buffered.length - 1) / v.duration) * 100,
                  );
                  setVideoProgress((prev) => (prev === null || pct > prev ? pct : prev));
                }
              }}
              onCanPlay={onPreviewReady}
              onLoadedData={() => dlog("hoverpreview", "[VideoCard] video loadeddata", { id: recording.id, src: videoUrl })}
              onPlaying={() => dlog("hoverpreview", "[VideoCard] video playing", { id: recording.id, loop: true })}
              onEnded={() => dlog("hoverpreview", "[VideoCard] video ENDED (not looping?)", { id: recording.id })}
              onError={() => {
                if (previewIndex + 1 < webpFallbacks.length) {
                  setMediaFail("none");
                  setPreviewReady(false);
                  setPreviewIndex(i => i + 1);
                } else {
                  setMediaFail("all");
                }
              }}
              ref={(el) => {
                if (el) (el as HTMLVideoElement & { referrerPolicy?: string }).referrerPolicy = "no-referrer";
              }}
            />
          )}
          {showImgFallback && animatedImageUrl && (
            <img
              src={animatedImageUrl}
              alt={recording.username}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"              onLoad={() => setPreviewReady(true)}
              onError={() => {
                if (previewIndex + 1 < webpFallbacks.length) {
                  setMediaFail("none");
                  setPreviewReady(false);
                  setPreviewIndex(i => i + 1);
                } else {
                  setMediaFail("all");
                }
              }}
            />
          )}




          {/* Hover feedback while media loads: a subtle glass shine sweep
              across the card plus the real-time progress bar driven by actual
              bytes received (sprite stream / video buffered ranges). No
              spinner/loader circle — progress is shown by the bar itself. */}
          {showLoadingBar && (
            <>
              <div className="preview-loading-shimmer" />
              {hoverProgress !== null && (
                <div className="absolute bottom-0 left-0 right-0 z-20 h-[3px] bg-black/40 pointer-events-none">
                  <div
                    className="h-full bg-primary/90 transition-[width] duration-150 ease-out"
                    style={{ width: `${hoverProgress}%` }}
                  />
                </div>
              )}
            </>
          )}

          {/* Watched badge */}
          {isWatched && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-black/40 backdrop-blur-sm ring-1 ring-white/10 px-1.5 py-0.5 rounded-[2px] pointer-events-none">
              <CheckCircle className="w-2.5 h-2.5 text-green-400" />
              <span className="text-[9px] font-semibold text-green-300/90 uppercase tracking-wider">Watched</span>
            </div>
          )}

          <div className="absolute top-2 left-2 flex items-center gap-1 pointer-events-none">
            {recording.resolution && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/90 bg-black/30 backdrop-blur-sm ring-1 ring-white/10 px-1.5 py-0.5 rounded-[2px]">
                {recording.resolution}
              </span>
            )}
            {recording.framerate != null && recording.framerate > 0 && (
              <span className="text-[9px] font-bold text-white/70 bg-black/30 backdrop-blur-sm ring-1 ring-white/10 px-1.5 py-0.5 rounded-[2px]">
                {recording.framerate}fps
              </span>
            )}
          </div>

          {/* Progress bar */}
          {progress !== undefined && progress > 0 && progress < 100 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40 z-10">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {progress !== undefined && progress >= 100 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-green-500/60 z-10" />
          )}

          <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between pointer-events-none">
            {showDuration ? (
              <span className="flex items-center gap-1 text-[9px] text-white/70 bg-black/30 backdrop-blur-sm ring-1 ring-white/10 px-1.5 py-0.5 rounded-[2px]">
                <Clock className="w-2.5 h-2.5" />
                {formatDuration(recording.duration)}
              </span>
            ) : showFilesize ? (
              <span className="flex items-center gap-1 text-[9px] text-white/70 bg-black/30 backdrop-blur-sm ring-1 ring-white/10 px-1.5 py-0.5 rounded-[2px]">
                <HardDrive className="w-2.5 h-2.5" />
                {formatBytes(recording.filesize)}
              </span>
            ) : <span />}
          </div>

          {showRemove && onRemove && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
              className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center bg-black/30 backdrop-blur-sm ring-1 ring-white/10 hover:bg-red-600/70 hover:ring-red-600/30 text-white rounded-[2px] opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold"
              aria-label="Remove"
            >
              ✕
            </button>
          )}
        </div>

        <div className="px-0.5 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-primary/90 group-hover:text-primary transition-colors truncate">
              {recording.username}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground/50">
              {formatRelativeTime(recording.timestamp)}
            </span>
            {showViewers && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
                <Eye className="w-2.5 h-2.5" />
                {formatViewers(recording.viewers)} views
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
});
