import { useMemo, useState, useEffect, useCallback, useRef, memo } from "react";
import { Link } from "wouter";
import type { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime, formatViewers, formatDuration } from "@/lib/formatters";
import { Eye, HardDrive, Clock, CheckCircle } from "lucide-react";
import { OptimizedImage, ImageUnavailable } from "@/components/ui/optimized-image";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { SpriteSlideshow } from "@/components/SpriteSlideshow";
import { cn } from "@/lib/utils";
import { proxyUrl, proxySpriteUrl, catboxProxyUrl } from "@/lib/proxy-url";
import { getSpriteGrid } from "@/lib/sprite-grid";
import { cacheImage } from "@/lib/image-cache";
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

  // Mirror fallback state - track which fallback we're currently trying
  const [previewIndex, setPreviewIndex] = useState(0);
  const [thumbnailIndex, setThumbnailIndex] = useState(0);
  const [spriteIndex, setSpriteIndex] = useState(0);

  const thumbnailUrl = useMemo(() => thumbnailFallbacks[thumbnailIndex] ? proxyUrl(thumbnailFallbacks[thumbnailIndex]) : null, [thumbnailFallbacks, thumbnailIndex]);
  const previewUrl = useMemo(() => previewFallbacks[previewIndex] ? proxyUrl(previewFallbacks[previewIndex]) : null, [previewFallbacks, previewIndex]);
  const spriteUrl = useMemo(() => spriteFallbacks[spriteIndex] ? proxySpriteUrl(spriteFallbacks[spriteIndex]) : null, [spriteFallbacks, spriteIndex]);
  const spriteGrid = useMemo(() => getSpriteGrid(spriteFallbacks[spriteIndex] || null), [spriteFallbacks, spriteIndex]);

  // Disable hover previews on slow connections — they saturate the
  // bandwidth and make the grid feel unresponsive. Users see static
  // thumbnails and click to watch full videos.
  const isSlowConnection = useMemo(() => {
    try {
      const conn = (navigator as any).connection;
      if (conn && (conn.saveData || (typeof conn.effectiveType === 'string' && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)))) return true;
    } catch {}
    return false;
  }, []);

  const {
    isHovered,
    showVideo,
    showAnimatedImage,
    videoUrl,
    animatedImageUrl,
    hoverHandlers,
    viewportRef,
    preloadVideoUrl,
  } = useHoverPreview({ thumbnailUrl, previewUrl, spriteUrl, enabled: !isSlowConnection });

  const staticImage = thumbnailUrl;
  const hasStaticImage = !!staticImage;
  const initials = useMemo(() => recording.username?.slice(0, 2).toUpperCase() ?? "??", [recording.username]);

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

  // ── .webp preview warm-up ──────────────────────────────────────────────
  // Eagerly cache .webp previews into IDB on mount so they're ready for hover.
  // The <img> itself uses the real proxied URL (not an IDB blob URL) — blob
  // URLs handed to lazy/hover-deferred <img> can be revoked by the memory-cache
  // cleanup before they paint, yielding blob:ERR_FILE_NOT_FOUND. Browser HTTP
  // cache + SW already make repeat visits near-instant.
  useEffect(() => {
    if (!previewUrl || isSlowConnection) return;
    const inspectUrl = getOriginalUrl(previewUrl) ?? previewUrl;
    // Static webp previews (iili.io .th.webp, pixhost) are not shown and catbox
    // webps load via the Worker proxy, so neither is warmed through this cache.
    if (getExt(inspectUrl) === ".webp") return;
    if (/catbox\.moe/i.test(inspectUrl)) return;
    cacheImage(previewUrl, 1).catch(() => {}); // fire-and-forget — preview = cold, evict first
  }, [previewUrl, isSlowConnection]);

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
  const showCatboxWebpImg = !!catboxWorkerUrl && usePreviewChain && showAnimatedImage && mediaFail === "none";
  const showWebpImg = isAnimatedImg && !isStaticThumb && !isCatboxPreview && usePreviewChain && showAnimatedImage && mediaFail === "none";
  const showVideoEl = isRealVideo && usePreviewChain && showVideo && mediaFail === "none";
  const showImgFallback = isRealVideo && usePreviewChain && showAnimatedImage && mediaFail === "video";

  const showSprite = isHovered && useSprite;

  // Show loading shimmer whenever the user is hovering and something is
  // loading but nothing is visually playing yet. Once the sprite or preview
  // paints, the shimmer disappears — the user has real content.
  const showLoadingBar = isHovered && !spriteReady && !previewReady && (useSprite || usePreviewChain);

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
  useEffect(() => {
    if (!(showVideoEl || showImgFallback || showCatboxWebpImg) || previewReady) {
      return;
    }
    const t = setTimeout(() => setMediaFail("all"), PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [showVideoEl, showImgFallback, showCatboxWebpImg, previewReady]);

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
              on top of the thumbnail. No need to hide the thumbnail because
              the sprite covers it when ready. */}
          {showSprite && spriteUrl && (
            <SpriteSlideshow
              spriteUrl={spriteUrl}
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
          {showWebpImg && animatedImageUrl && (
            <img
              src={animatedImageUrl}
              alt={recording.username}
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
              style={{ opacity: previewReady ? 1 : 0 }}
              onLoad={() => setPreviewReady(true)}
              onError={() => {
                if (previewIndex + 1 < previewFallbacks.length) {
                  setMediaFail("none");
                  setPreviewReady(false);
                  setPreviewIndex((i) => i + 1);
                } else {
                  setMediaFail("all");
                }
              }}
            />
          )}
          {showCatboxWebpImg && catboxWorkerUrl && (
            <img
              src={catboxWorkerUrl}
              alt={recording.username}
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
              style={{ opacity: 1 }}
              onLoad={() => {
                dlog("hoverpreview", "[VideoCard] catbox webp loaded (worker proxy)", { id: recording.id, src: catboxWorkerUrl });
                setPreviewReady(true);
              }}
              onError={(e) => {
                dlog("hoverpreview", "[VideoCard] catbox webp failed (worker proxy), trying next fallback", { id: recording.id, index: previewIndex });
                if (previewIndex + 1 < previewFallbacks.length) {
                  setMediaFail("none");
                  setPreviewReady(false);
                  setPreviewIndex(i => i + 1);
                } else {
                  setMediaFail("all");
                }
              }}
            />
          )}
          {showVideoEl && videoUrl && (
            <video
              src={videoUrl}
              poster={hasStaticImage ? staticImage! : undefined}
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                previewReady ? "opacity-100" : "opacity-0"
              )}
              autoPlay muted playsInline loop
              preload="auto"
              onCanPlay={onPreviewReady}
              onLoadedData={() => dlog("hoverpreview", "[VideoCard] video loadeddata", { id: recording.id, src: videoUrl })}
              onPlaying={() => dlog("hoverpreview", "[VideoCard] video playing", { id: recording.id, loop: true })}
              onEnded={() => dlog("hoverpreview", "[VideoCard] video ENDED (not looping?)", { id: recording.id })}
              onError={() => {
                if (previewIndex + 1 < previewFallbacks.length) {
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
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
              onLoad={() => setPreviewReady(true)}
              onError={() => {
                if (previewIndex + 1 < previewFallbacks.length) {
                  setMediaFail("none");
                  setPreviewReady(false);
                  setPreviewIndex(i => i + 1);
                } else {
                  setMediaFail("all");
                }
              }}
            />
          )}



          {/* Shimmer + pulse animation while the preview loads — replaces
              the old thin progress bar with a more attractive effect. */}
          {showLoadingBar && (
            <>
              <div className="preview-loading-shimmer" />
              <div className="preview-loading-pulse" />
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
