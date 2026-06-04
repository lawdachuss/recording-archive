import { useState } from "react";
import { Link } from "wouter";
import { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";

interface VideoCardProps {
  recording: Recording;
}

export function VideoCard({ recording }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const src = isHovered && recording.preview_url
    ? recording.preview_url
    : recording.thumbnail_url || undefined;

  return (
    <Link href={`/video/${recording.id}`} className="group block outline-none">
      <div
        className="flex flex-col gap-2.5"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative aspect-video overflow-hidden bg-secondary">
          {src ? (
            <img
              src={src}
              alt={recording.room_title || recording.filename}
              className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ${
                isHovered ? "scale-[1.03]" : "scale-100"
              }`}
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 bg-secondary" />
          )}

          <div
            className={`absolute inset-0 bg-black/20 transition-opacity duration-300 ${
              isHovered ? "opacity-100" : "opacity-0"
            }`}
          />

          {recording.resolution && (
            <div className="absolute top-2 left-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/80 bg-black/70 px-1.5 py-0.5">
                {recording.resolution}
              </span>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-[13px] font-medium leading-snug line-clamp-1 text-foreground/90 group-hover:text-foreground transition-colors">
            {recording.room_title || recording.filename}
          </h3>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[12px] text-muted-foreground font-medium">
              {recording.username}
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              {formatRelativeTime(recording.timestamp)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
