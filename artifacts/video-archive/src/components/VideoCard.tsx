import { useMemo, memo } from "react";
import { Link } from "wouter";
import type { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime, formatViewers, formatDuration } from "@/lib/formatters";
import { Eye, HardDrive, Clock, CheckCircle } from "lucide-react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { SpriteSlideshow } from "@/components/SpriteSlideshow";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { cn } from "@/lib/utils";

const CORS_HOSTS: string[] = [
  "pixhost.to",
  "img2.pixhost.to",
  "lobfile.com",
  "files.catbox.moe",
  "catbox.moe",
  "i.ibb.co",
  "ibb.co",
  "pixeldrain.com",
  "www.pixeldrain.com",
];

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

const BLOCKED_HOSTS: string[] = [];

function isHostBlocked(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return BLOCKED_HOSTS.some((h) => hostname.includes(h));
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

// Known sprite grid layouts for common hosts — avoids loading the image
// to auto-detect dimensions, so animation starts instantly on hover.
function getSpriteGrid(url: string | null | undefined): { cols: number; rows: number } | null {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    if (hostname.includes("pixhost.to")) return { cols: 4, rows: 4 };
    return null;
  } catch {
    return null;
  }
}

export const VideoCard = memo(function VideoCard({ recording, showRemove, onRemove, fetchPriority, isWatched }: VideoCardProps) {
  const thumbnailUrl = useMemo(() => proxyUrl(recording.thumbnail_url), [recording.thumbnail_url]);
  // Sprite URLs don't need the proxy — browsers load cross-origin images for
  // background-image and <img> without CORS. Using the direct CDN URL avoids
  // the serverless function cold start delay, so the sprite appears instantly.
  const spriteUrl = useMemo(() => recording.sprite_url ?? null, [recording.sprite_url]);
  const spriteGrid = useMemo(() => getSpriteGrid(recording.sprite_url), [recording.sprite_url]);
  const previewUrl = useMemo(() => recording.preview_url ?? null, [recording.preview_url]);

  const {
    isHovered,
    showVideo,
    showSprite,
    videoUrl,
    hoverHandlers,
    viewportRef,
  } = useHoverPreview({ thumbnailUrl, spriteUrl, previewUrl });

  const staticImage = thumbnailUrl;
  const staticImageBlocked = staticImage ? isHostBlocked(staticImage) : false;
  const hasStaticImage = !!staticImage && !staticImageBlocked;
  const initials = useMemo(() => recording.username?.slice(0, 2).toUpperCase() ?? "??", [recording.username]);

  const showPreview = isHovered && (showVideo || showSprite);

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
          {hasStaticImage ? (
            <div className="absolute inset-0 w-full h-full">
              <OptimizedImage
                src={staticImage!}
                alt={recording.username}
                fetchPriority={fetchPriority}
                loading={fetchPriority === "high" ? "eager" : "lazy"}
                className={cn(
                  "transition-opacity duration-300 ease-out",
                  showPreview ? "opacity-0" : "opacity-100"
                )}
                containerClassName="absolute inset-0 w-full h-full"
                fallback={
                  <div className="absolute inset-0 bg-secondary" />
                }
                noShimmer
              />

              {showVideo && videoUrl && (
                <video
                  src={videoUrl}
                  className="absolute inset-0 w-full h-full object-cover"
                  autoPlay muted playsInline
                  preload="auto"
                />
              )}

              {showSprite && (
                <SpriteSlideshow
                  spriteUrl={spriteUrl!}
                  cols={spriteGrid?.cols}
                  rows={spriteGrid?.rows}
                  className="absolute inset-0 w-full h-full"
                  active={isHovered}
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

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-50 pointer-events-none" />

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
