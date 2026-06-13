import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime, formatViewers, formatDuration } from "@/lib/formatters";
import { Eye, Play, HardDrive, Film, Clock } from "lucide-react";
import { OptimizedImage } from "@/components/ui/optimized-image";

interface VideoCardProps {
  recording: Recording;
  showRemove?: boolean;
  onRemove?: () => void;
  fetchPriority?: "high" | "low" | "auto";
}

export function VideoCard({ recording, showRemove, onRemove, fetchPriority }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Preload preview image (or sprite as fallback) when card nears viewport
  useEffect(() => {
    const hoverUrl = recording.preview_url || recording.sprite_url;
    if (!hoverUrl) return;
    const el = cardRef.current;
    if (!el) return;

    let timer: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = window.setTimeout(() => {
            const img = new Image();
            img.src = hoverUrl;
          }, 300);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [recording.preview_url, recording.sprite_url]);

  // Use thumbnail if available, otherwise fall back to preview as a static image
  const staticImage = recording.thumbnail_url || recording.preview_url;
  const hasStaticImage = !!staticImage;
  const initials = recording.username?.slice(0, 2).toUpperCase() ?? "??";

  const handlePreviewError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    // If preview fails and we have a different sprite URL, fall back to sprite
    if (recording.sprite_url && e.currentTarget.src !== recording.sprite_url) {
      e.currentTarget.src = recording.sprite_url;
    }
    // If sprite is the same or both fail, just leave thumbnail visible (no overlay needed)
  };

  const showPreview = isHovered && (recording.preview_url || recording.sprite_url);

  return (
    <Link
      href={`/video/${recording.id}`}
      className="group block outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
    >
      <div
        ref={cardRef}
        className="flex flex-col gap-2"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Thumbnail */}
        <div className="relative aspect-video overflow-hidden bg-secondary rounded-sm">
          {/* Base: thumbnail, preview-as-thumbnail, or initials fallback */}
          {hasStaticImage ? (
            <OptimizedImage
              src={staticImage!}
              alt={recording.username}
              fetchPriority={fetchPriority}
              loading={fetchPriority === "high" ? "eager" : "lazy"}
              className={`transition-transform duration-500 ${
                isHovered ? "scale-[1.04]" : "scale-100"
              }`}
              containerClassName="absolute inset-0 w-full h-full"
              fallback={
                <div className="absolute inset-0 bg-secondary flex items-center justify-center">
                  <Play className="w-6 h-6 text-muted-foreground/20" />
                </div>
              }
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-secondary/80 to-secondary">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <Film className="w-4 h-4 text-primary/40" />
              </div>
              <span className="text-xs font-bold text-muted-foreground/30 uppercase tracking-wider">
                {initials}
              </span>
            </div>
          )}

          {/* Hover overlay: preview (or sprite fallback) — separate img, no shimmer */}
          {showPreview && (
            <img
              key={recording.id}
              src={recording.preview_url || recording.sprite_url!}
              alt=""
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
              onError={handlePreviewError}
            />
          )}

          <div
            className={`absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent transition-opacity duration-300 ${
              isHovered ? "opacity-100" : "opacity-40"
            }`}
          />

          {/* Play icon */}
          <div
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
              isHovered ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </div>
          </div>

          {/* Top-left: resolution badge */}
          <div className="absolute top-2 left-2 flex items-center gap-1">
            {recording.resolution && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/90 bg-black/70 px-1.5 py-0.5 rounded-[2px]">
                {recording.resolution}
              </span>
            )}
            {recording.framerate != null && recording.framerate > 0 && (
              <span className="text-[9px] font-bold text-white/70 bg-black/60 px-1.5 py-0.5 rounded-[2px]">
                {recording.framerate}fps
              </span>
            )}
          </div>

          {/* Bottom row on thumbnail */}
          <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
{(recording.duration ?? 0) > 0 ? (
              <span className="flex items-center gap-1 text-[9px] text-white/70 bg-black/60 px-1.5 py-0.5 rounded-[2px]">
                <Clock className="w-2.5 h-2.5" />
                {formatDuration(recording.duration)}
              </span>
            ) : recording.filesize ? (
              <span className="flex items-center gap-1 text-[9px] text-white/70 bg-black/60 px-1.5 py-0.5 rounded-[2px]">
                <HardDrive className="w-2.5 h-2.5" />
                {formatBytes(recording.filesize)}
              </span>
            ) : <span />}
          {recording.viewers != null && recording.viewers > 0 && (
              <span className="flex items-center gap-1 text-[9px] text-white/70 bg-black/60 px-1.5 py-0.5 rounded-[2px]">
                <Eye className="w-2.5 h-2.5" />
                {formatViewers(recording.viewers)}
              </span>
            )}
          </div>

          {/* Remove button overlay */}
          {showRemove && onRemove && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
              className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center bg-black/70 hover:bg-red-600/90 text-white rounded-[2px] opacity-0 group-hover:opacity-100 transition-all text-[10px] font-bold"
              aria-label="Remove"
            >
              ✕
            </button>
          )}
        </div>

        {/* Info below thumbnail */}
        <div className="px-0.5 space-y-1">
          {/* Channel name — most prominent */}
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <Film className="w-2.5 h-2.5 text-primary/70" />
            </div>
            <span className="text-[13px] font-semibold text-primary/90 group-hover:text-primary transition-colors truncate">
              {recording.username}
            </span>
          </div>

          {/* Date + views row */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground/50">
              {formatRelativeTime(recording.timestamp)}
            </span>
            {recording.viewers != null && recording.viewers > 0 && (
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
}
