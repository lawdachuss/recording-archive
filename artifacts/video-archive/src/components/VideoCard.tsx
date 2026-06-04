import { useState } from "react";
import { Link } from "wouter";
import { Recording } from "@workspace/api-client-react";
import { formatRelativeTime, formatViewers } from "@/lib/formatters";
import { Eye, Play } from "lucide-react";

interface VideoCardProps {
  recording: Recording;
}

export function VideoCard({ recording }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const src =
    isHovered && recording.preview_url
      ? recording.preview_url
      : recording.thumbnail_url || undefined;

  const displayTags = recording.tags?.slice(0, 2) ?? [];

  return (
    <Link href={`/video/${recording.id}`} className="group block outline-none focus-visible:ring-1 focus-visible:ring-primary rounded">
      <div
        className="flex flex-col gap-2.5"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative aspect-video overflow-hidden bg-secondary rounded-sm">
          {src ? (
            <img
              src={src}
              alt={recording.room_title || recording.filename}
              className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ${
                isHovered ? "scale-[1.04]" : "scale-100"
              }`}
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 bg-secondary flex items-center justify-center">
              <Play className="w-6 h-6 text-muted-foreground/20" />
            </div>
          )}

          <div
            className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity duration-300 ${
              isHovered ? "opacity-100" : "opacity-0"
            }`}
          />

          {/* Play icon on hover */}
          <div
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
              isHovered ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </div>
          </div>

          {/* Badges row */}
          <div className="absolute top-2 left-2 flex items-center gap-1">
            {recording.resolution && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/90 bg-black/70 px-1.5 py-0.5 rounded-[2px]">
                {recording.resolution}
              </span>
            )}
          </div>

          {/* Viewers bottom-right */}
          {recording.viewers && recording.viewers > 0 && (
            <div className="absolute bottom-2 right-2">
              <span className="flex items-center gap-1 text-[10px] text-white/70 bg-black/60 px-1.5 py-0.5 rounded-[2px]">
                <Eye className="w-2.5 h-2.5" />
                {formatViewers(recording.viewers)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <h3 className="text-[13px] font-medium leading-snug line-clamp-1 text-foreground/90 group-hover:text-foreground transition-colors">
            {recording.room_title || recording.filename}
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-primary/80 font-medium hover:text-primary transition-colors truncate max-w-[60%]">
              {recording.username}
            </span>
            <span className="text-[11px] text-muted-foreground/50 shrink-0">
              {formatRelativeTime(recording.timestamp)}
            </span>
          </div>
          {displayTags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {displayTags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] text-muted-foreground/50 border border-border/40 px-1.5 py-px rounded-[2px] leading-none"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
