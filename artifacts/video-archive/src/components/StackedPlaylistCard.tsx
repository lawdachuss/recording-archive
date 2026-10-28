import { Link } from "wouter";
import { ListVideo, Film, User, Play } from "lucide-react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { proxyUrl } from "@/lib/proxy-url";

export interface PlaylistAuthor {
  display_name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
}

export interface PlaylistCardItem {
  recording_id: string;
  metadata?: string | null;
}

export interface PublicPlaylist {
  id: string;
  name: string;
  description?: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
  items?: PlaylistCardItem[];
  author?: PlaylistAuthor | null;
}

interface StackedPlaylistCardProps {
  playlist: PublicPlaylist;
}

export function StackedPlaylistCard({ playlist }: StackedPlaylistCardProps) {
  // Extract up to 3 thumbnails for the stacked deck
  const thumbnails = (playlist.items ?? [])
    .map((item) => {
      if (!item.metadata) return null;
      try {
        const parsed = JSON.parse(item.metadata);
        return parsed.thumbnail_url ? proxyUrl(parsed.thumbnail_url) : null;
      } catch {
        return null;
      }
    })
    .filter((url): url is string => !!url);

  const topThumb = thumbnails[0];
  const midThumb = thumbnails[1] ?? topThumb;
  const backThumb = thumbnails[2] ?? midThumb ?? topThumb;

  const authorName =
    playlist.author?.display_name ||
    playlist.author?.username ||
    "Community User";

  return (
    <Link
      href={`/collections/${playlist.id}`}
      className="group flex flex-col gap-3 p-3 rounded-2xl border border-border/30 hover:border-primary/40 bg-card/60 hover:bg-card transition-all duration-300 animate-fade-in-up cursor-pointer"
    >
      {/* Stacked Thumbnail Deck Container */}
      <div className="relative w-full aspect-video pt-2">
        {/* Back Stack Layer */}
        <div className="absolute inset-x-4 -top-2 bottom-4 rounded-xl bg-muted/60 border border-border/40 overflow-hidden transform scale-[0.88] translate-y-[-8px] opacity-60 transition-transform duration-300 group-hover:scale-[0.90] group-hover:translate-y-[-10px] shadow-sm">
          {backThumb ? (
            <img src={backThumb} alt="" className="w-full h-full object-cover blur-[0.5px]" />
          ) : (
            <div className="w-full h-full bg-secondary/80 flex items-center justify-center">
              <Film className="w-6 h-6 text-muted-foreground/30" />
            </div>
          )}
        </div>

        {/* Middle Stack Layer */}
        <div className="absolute inset-x-2 -top-1 bottom-2 rounded-xl bg-muted/80 border border-border/50 overflow-hidden transform scale-[0.94] translate-y-[-4px] opacity-85 transition-transform duration-300 group-hover:scale-[0.95] group-hover:translate-y-[-5px] shadow-md">
          {midThumb ? (
            <img src={midThumb} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-secondary flex items-center justify-center">
              <Film className="w-6 h-6 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Top Front Layer */}
        <div className="relative w-full h-full rounded-xl overflow-hidden border border-border/60 bg-secondary shadow-lg transition-transform duration-300 group-hover:scale-[1.01]">
          {topThumb ? (
            <OptimizedImage
              src={topThumb}
              alt={playlist.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary/90">
              <Film className="w-8 h-8 text-muted-foreground/30" />
            </div>
          )}

          {/* Hover Play Overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform duration-300">
              <Play className="w-6 h-6 fill-current ml-0.5" />
            </div>
          </div>

          {/* Item Count Badge Overlay */}
          <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-white text-[11px] font-semibold shadow-md">
            <ListVideo className="w-3.5 h-3.5 text-primary" />
            <span>{playlist.item_count} {playlist.item_count === 1 ? "video" : "videos"}</span>
          </div>
        </div>
      </div>

      {/* Meta details */}
      <div className="px-1 flex flex-col gap-1 min-w-0">
        <h3 className="text-sm font-bold tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-1">
          {playlist.name}
        </h3>
        {playlist.description && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {playlist.description}
          </p>
        )}

        {/* Author row */}
        <div className="flex items-center gap-2 mt-1 pt-1 border-t border-border/20">
          {playlist.author?.avatar_url ? (
            <img
              src={proxyUrl(playlist.author.avatar_url) || undefined}
              alt={authorName}
              className="w-5 h-5 rounded-full object-cover border border-border/40 shrink-0"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-secondary border border-border/40 flex items-center justify-center shrink-0">
              <User className="w-3 h-3 text-muted-foreground" />
            </div>
          )}
          <span className="text-[11px] font-medium text-muted-foreground truncate">
            {authorName}
          </span>
        </div>
      </div>
    </Link>
  );
}
