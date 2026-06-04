import { useState } from "react";
import { Link } from "wouter";
import { Play } from "lucide-react";
import { Recording } from "@workspace/api-client-react";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";

interface VideoCardProps {
  recording: Recording;
}

export function VideoCard({ recording }: VideoCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link href={`/video/${recording.id}`} className="group block outline-none">
      <div 
        className="flex flex-col gap-3"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative aspect-video rounded-xl overflow-hidden bg-muted isolate">
          {/* Fallback pattern */}
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary via-background to-background" />
          
          <img
            src={(isHovered && recording.preview_url) ? recording.preview_url : recording.thumbnail_url || undefined}
            alt={recording.room_title || recording.filename}
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 ${
              isHovered ? 'scale-105 opacity-90' : 'scale-100 opacity-100'
            }`}
            loading="lazy"
          />
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300" />
          
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 scale-90 group-hover:scale-100">
            <div className="w-14 h-14 bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center backdrop-blur-sm shadow-xl shadow-primary/20">
              <Play className="w-6 h-6 ml-1" fill="currentColor" />
            </div>
          </div>

          <div className="absolute top-2 right-2 flex gap-1">
            {recording.resolution && (
              <span className="px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[10px] font-bold text-white uppercase tracking-wider">
                {recording.resolution}
              </span>
            )}
          </div>

          <div className="absolute bottom-2 left-2 flex gap-1 flex-wrap pr-2 max-h-12 overflow-hidden">
            {recording.tags?.slice(0, 3).map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-medium text-white/90">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="px-1">
          <h3 className="font-semibold text-sm line-clamp-1 leading-snug group-hover:text-primary transition-colors">
            {recording.room_title || recording.filename}
          </h3>
          <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground/80 hover:text-foreground transition-colors">
                {recording.username}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span>{formatBytes(recording.filesize)}</span>
              <span className="w-1 h-1 rounded-full bg-border" />
              <span>{formatRelativeTime(recording.timestamp)}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
