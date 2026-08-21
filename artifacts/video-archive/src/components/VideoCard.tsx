import { useMemo, useState, useEffect, useCallback, memo } from "react";
import { Link } from "wouter";
import type { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime, formatViewers, formatDuration } from "@/lib/formatters";
import { Eye, HardDrive, Clock, CheckCircle } from "lucide-react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { SpriteSlideshow } from "@/components/SpriteSlideshow";
import { cn } from "@/lib/utils";
import { proxyUrl } from "@/lib/proxy-url";
import { getSpriteGrid } from "@/lib/sprite-grid";

// If a hover preview hasn't produced its first frame within this window,
// treat the source as unreachable and fall back (files.catbox.moe consistently
// times out for minutes on this network; the browser would otherwise leave the
// request hanging and never engage the sprite/static fallback).
const PREVIEW_TIMEOUT_MS = 6000;

interface VideoCardProps {
  recording: Recording;
  showRemove?: boolean;
  onRemove?: () => void;
  fetchPriority?: "high" | "low" | "auto";
  isWatched?: boolean;
}

export const VideoCard = memo(function VideoCard({ recording, showRemove, onRemove, fetchPriority, isWatched }: VideoCardProps) {
  const thumbnailUrl = useMemo(() => proxyUrl(recording.thumbnail_url), [recording.thumbnail_url]);
  const previewUrl = useMemo(() => proxyUrl(recording.preview_url), [recording.preview_url]);
  const spriteUrl = useMemo(() => proxyUrl(recording.sprite_url), [recording.sprite_url]);
  const spriteGrid = useMemo(() => getSpriteGrid(recording.sprite_url), [recording.sprite_url]);

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

  // Preview playback fallback chain:
  //   <video> -> (on error, if .webp) <img> -> (on error) static thumbnail.
  // .webp previews in this DB are mostly MP4 clips with a misleading extension,
  // so we attempt <video> first; genuine animated WebP falls back to <img>.
  const [mediaFail, setMediaFail] = useState<"none" | "video" | "all">("none");
  // The preview is only swapped over the thumbnail once it actually has frames
  // (`onLoadedData`) — until then the thumbnail stays visible with a loading
  // bar, so hovering never flashes a black box.
  const [previewReady, setPreviewReady] = useState(false);
  // Real-time buffered progress of the hover video (0-100), shown as the bar
  // at the bottom of the card so the loader reflects the actual fetch.
  const [bufferProgress, setBufferProgress] = useState(0);
  useEffect(() => {
    setMediaFail("none");
    setPreviewReady(false);
    setBufferProgress(0);
  }, [previewUrl]);

  // The hover <video> unmounts when the pointer leaves, so re-entering must
  // go through the ready gate again (loading bar over thumbnail, never black).
  useEffect(() => {
    if (!isHovered) {
      setPreviewReady(false);
      setBufferProgress(0);
      setSpriteReady(false);
      setSpriteFailed(false);
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

  const onPreviewProgress = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    const duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const buffered = v.buffered;
    if (!buffered || buffered.length === 0) return;
    const loaded = buffered.end(buffered.length - 1);
    const pct = Math.min(100, Math.max(0, Math.round((loaded / duration) * 100)));
    setBufferProgress(pct);
  }, []);

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

  // The real animated preview is the primary hover experience whenever one
  // exists (most recordings have one; historically catbox previews were
  // unreachable, which is why the sprite sheet was made primary — those host
  // issues are now the exception, not the rule). The sprite sheet is only a
  // fallback: used when a recording has no preview at all, or the preview has
  // been exhausted (mediaFail === "all" — the 6s fail-fast timer fired or the
  // <video>/<img> chain errored).
  const usePreviewChain = previewAvailable && mediaFail !== "all";
  const useSprite = spriteAvailable && !spriteFailed && (!previewAvailable || mediaFail === "all");

  const showVideoEl = usePreviewChain && showVideo && mediaFail === "none";
  const showImgFallback = usePreviewChain && showAnimatedImage && mediaFail === "video";
  const restoreStatic =
    mediaFail === "all" || (mediaFail === "video" && !showAnimatedImage) || !usePreviewChain;

  const showSprite = isHovered && useSprite;

  // The thumbnail stays visible until the preview itself has frames. For the
  // <img> fallback the thumbnail also stays put until onLoad flips previewReady
  // (the img renders above it), so there is never an empty frame. The sprite
  // sheet keeps the thumbnail underneath until it has painted (spriteReady).
  const hideStatic =
    (showSprite && spriteReady) || (showPreview && !restoreStatic && previewReady);
  const showLoadingBar =
    usePreviewChain && showPreview && mediaFail === "none" && !previewReady;

  // Fail-fast timer: unmount the hanging <video> / <img> after the timeout and
  // mark the preview failed, so the sprite/static fallback engages in seconds
  // instead of the browser's multi-minute connection timeout.
  useEffect(() => {
    if (!(showVideoEl || showImgFallback) || previewReady) {
      return;
    }
    const t = setTimeout(() => setMediaFail("all"), PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [showVideoEl, showImgFallback, previewReady]);

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

          {usePreviewChain && preloadVideoUrl && !isSlowConnection && (
            <video
              src={preloadVideoUrl}
              className="hidden"
              muted playsInline preload="auto"
              aria-hidden
              ref={(el) => {
                if (el) (el as HTMLVideoElement & { referrerPolicy?: string }).referrerPolicy = "no-referrer";
              }}
            />
          )}

          {hasStaticImage ? (
            <div className="absolute inset-0 w-full h-full">
              <OptimizedImage
                src={staticImage!}
                alt={recording.username}
                fetchPriority={fetchPriority}
                loading={fetchPriority === "high" ? "eager" : "lazy"}
                className={cn(
                  "transition-opacity duration-300 ease-out",
                  hideStatic ? "opacity-0" : "opacity-100"
                )}
                containerClassName="absolute inset-0 w-full h-full"
                fallback={
                  <div className="absolute inset-0 bg-secondary" />
                }
                noShimmer
              />

              {showVideoEl && videoUrl && (
                <video
                  src={videoUrl}
                  poster={hasStaticImage ? staticImage! : undefined}
                  className={cn(
                    "absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ease-out",
                    previewReady ? "opacity-100" : "opacity-0"
                  )}
                  autoPlay muted playsInline
                  preload="auto"
                  onProgress={onPreviewProgress}
                  onCanPlay={onPreviewReady}
                  onError={() => setMediaFail((f) => (f === "none" ? "video" : f))}
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
                  className="absolute inset-0 w-full h-full object-cover"
                  onLoad={() => setPreviewReady(true)}
                  onError={() => setMediaFail("all")}
                />
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-secondary/80 to-secondary">
              <span className="text-lg font-bold text-muted-foreground/30 uppercase tracking-wider">
                {initials}
              </span>
            </div>
          )}

          {/* Sprite sheet is the primary hover preview when available — it
              renders above the thumbnail (or the initials fallback) so it
              works whether or not a static image exists. */}
          {showSprite && spriteUrl && (
            <SpriteSlideshow
              spriteUrl={spriteUrl}
              cols={spriteGrid?.cols}
              rows={spriteGrid?.rows}
              className="absolute inset-0 w-full h-full"
              active={showSprite}
              onLoaded={() => setSpriteReady(true)}
              onError={() => setSpriteFailed(true)}
            />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-50 pointer-events-none" />

          {/* Real-time loading bar pinned to the bottom while the preview
              buffers — width tracks the video's buffered progress, so the
              animation matches the actual fetch and playback starts the
              moment the bar completes. */}
          {showLoadingBar && (
            <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2 pointer-events-none">
              <div
                className="progress-loader"
                role="progressbar"
                aria-label="Loading preview"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={bufferProgress}
              >
                <div className="progress" style={{ width: `${bufferProgress}%` }} />
              </div>
            </div>
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
