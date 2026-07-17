import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { Link } from "wouter";
import type { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime, formatViewers, formatDuration } from "@/lib/formatters";
import { Eye, HardDrive, Clock, CheckCircle } from "lucide-react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { SpriteSlideshow } from "@/components/SpriteSlideshow";

const CORS_HOSTS: string[] = ["pixhost.to", "lobfile.com"];

function needsProxy(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return CORS_HOSTS.some((h) => hostname.includes(h));
  } catch {
    return false;
  }
}

function proxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (needsProxy(url)) {
    return `/api/media?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const BLOCKED_HOSTS: string[] = ["pixeldrain.com"];

function isHostBlocked(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return BLOCKED_HOSTS.some((h) => hostname.includes(h));
  } catch {
    return false;
  }
}

const IMAGE_PREVIEW_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];

function isImagePreview(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split("?")[0].split(".").pop()?.toLowerCase();
    return ext ? IMAGE_PREVIEW_EXTS.includes(`.${ext}`) : false;
  } catch {
    return false;
  }
}

interface VideoCardProps {
  recording: Recording;
  showRemove?: boolean;
  onRemove?: () => void;
  fetchPriority?: "high" | "low" | "auto";
  isWatched?: boolean;
}

export const VideoCard = memo(function VideoCard({ recording, showRemove, onRemove, fetchPriority, isWatched }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  const isHoveredRef = useRef(false);
  const warmedPreviewUrlsRef = useRef<Set<string>>(new Set());

  const previewUrl = useMemo(() => proxyUrl(recording.preview_url), [recording.preview_url]);
  const spriteUrl = useMemo(() => proxyUrl(recording.sprite_url), [recording.sprite_url]);
  const thumbnailUrl = useMemo(() => proxyUrl(recording.thumbnail_url), [recording.thumbnail_url]);

  const previewBlocked = useMemo(() => isHostBlocked(previewUrl), [previewUrl]);
  const spriteBlocked = useMemo(() => isHostBlocked(spriteUrl), [spriteUrl]);
  const thumbnailBlocked = useMemo(() => isHostBlocked(thumbnailUrl), [thumbnailUrl]);

  const previewFailed = videoError || previewBlocked;
  const hasPreview = !!previewUrl;
  const hasSprite = !!spriteUrl && !spriteBlocked;
  const previewIsImage = useMemo(() => isImagePreview(previewUrl), [previewUrl]);

  const hoverMedia: "mp4" | "sprite" | "none" = !isHovered
    ? "none"
    : hasPreview && !previewFailed && !previewIsImage
      ? "mp4"
      : hasSprite
        ? "sprite"
        : "none";

  useEffect(() => {
    setVideoError(false);
  }, [previewUrl]);

  const warmPreviewAsset = useCallback((url: string | null, type: "image" | "video") => {
    if (!url || warmedPreviewUrlsRef.current.has(url)) return;
    warmedPreviewUrlsRef.current.add(url);

    if (type === "image") {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      return;
    }

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = url;
    document.head.appendChild(link);
    window.setTimeout(() => link.remove(), 10_000);
  }, []);

  const handleMouseEnter = useCallback(() => {
    isHoveredRef.current = true;
    if (hasPreview && !previewBlocked && !previewIsImage) warmPreviewAsset(previewUrl, "video");
    if (hasSprite) warmPreviewAsset(spriteUrl, "image");
    hoverTimerRef.current = window.setTimeout(() => {
      if (isHoveredRef.current) {
        setIsHovered(true);
      }
    }, 80);
  }, [hasPreview, hasSprite, previewBlocked, previewIsImage, previewUrl, spriteUrl, warmPreviewAsset]);

  const handleMouseLeave = useCallback(() => {
    isHoveredRef.current = false;
    if (hoverTimerRef.current !== undefined) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = undefined;
    }
    setIsHovered(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== undefined) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hoverMedia === "mp4" && videoRef.current) {
      const playPromise = videoRef.current.play();
      if (playPromise) {
        playPromise.catch(() => {});
      }
    }
  }, [hoverMedia]);

  const staticImage = thumbnailUrl || (previewIsImage ? previewUrl : null);
  const staticImageBlocked = staticImage ? isHostBlocked(staticImage) : false;
  const hasStaticImage = !!staticImage && !staticImageBlocked;
  const initials = useMemo(() => recording.username?.slice(0, 2).toUpperCase() ?? "??", [recording.username]);

  const showDuration = (recording.duration ?? 0) > 0;
  const showFilesize = !!recording.filesize && !showDuration;
  const showViewers = recording.viewers != null;

  const handleVideoError = useCallback(() => {
    setVideoError(true);
  }, []);

  return (
    <Link
      href={`/video/${recording.id}`}
      className="group block outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
    >
      <div
        className="flex flex-col gap-2"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
      >
        <div className="relative aspect-video overflow-hidden bg-secondary rounded-sm will-change-transform">
          {hasStaticImage ? (
            <OptimizedImage
              src={staticImage!}
              alt={recording.username}
              fetchPriority={fetchPriority}
              loading={fetchPriority === "high" ? "eager" : "lazy"}
              className={[
                "transition-all duration-500 ease-out will-change-transform",
                isHovered ? "scale-[1.04]" : "scale-100",
              ].join(" ")}
              containerClassName="absolute inset-0 w-full h-full"
              fallback={
                <div className="absolute inset-0 bg-secondary" />
              }
              noShimmer
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-secondary/80 to-secondary">
              <span className="text-lg font-bold text-muted-foreground/30 uppercase tracking-wider">
                {initials}
              </span>
            </div>
          )}

          <div
            className={[
              "absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent transition-opacity duration-300 will-change-opacity",
              isHovered ? "opacity-100" : "opacity-50",
            ].join(" ")}
          />

          {hoverMedia === "mp4" && (
            <div className="absolute inset-0 transition-all duration-300 ease-out will-change-transform opacity-100 scale-100">
              <video
                ref={videoRef}
                key={recording.id}
                src={previewUrl!}
                muted
                playsInline
                loop
                preload="metadata"
                className="absolute inset-0 w-full h-full object-cover"
                onError={handleVideoError}
              />
            </div>
          )}

          {hoverMedia === "sprite" && (
            <div className="absolute inset-0 transition-all duration-300 ease-out will-change-transform opacity-100 scale-100">
              <SpriteSlideshow
                spriteUrl={spriteUrl!}
                fps={8}
                className="absolute inset-0 w-full h-full"
                active
              />
            </div>
          )}

          <div
            className={[
              "absolute inset-0 rounded-sm transition-all duration-300 pointer-events-none",
              isHovered
                ? "ring-1 ring-primary/40 shadow-[inset_0_0_20px_rgba(100,100,255,0.06)]"
                : "ring-0",
            ].join(" ")}
          />

          {/* Watched badge */}
          {isWatched && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-black/40 backdrop-blur-sm ring-1 ring-white/10 px-1.5 py-0.5 rounded-[2px] pointer-events-none">
              <CheckCircle className="w-2.5 h-2.5 text-green-400" />
              <span className="text-[9px] font-semibold text-green-300/90 uppercase tracking-wider">Watched</span>
            </div>
          )}

          <div className="absolute top-2 left-2 flex items-center gap-1">
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

          <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
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
