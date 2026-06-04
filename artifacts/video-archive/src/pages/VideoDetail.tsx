import { useRef, useState, useCallback } from "react";
import { useParams, Link } from "wouter";
import {
  useGetRecording,
  useListRelatedRecordings,
  getGetRecordingQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatBytes,
  formatRelativeTime,
} from "@/lib/formatters";
import {
  Eye,
  HardDrive,
  MonitorPlay,
  AlertCircle,
  ArrowLeft,
  Maximize2,
  Minimize2,
  Calendar,
  User,
  Tag,
  Clapperboard,
} from "lucide-react";

function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.requestFullscreen) {
      el.requestFullscreen();
    } else if ((el as any).webkitRequestFullscreen) {
      (el as any).webkitRequestFullscreen();
    }
    setIsFullscreen(true);
  }, [ref]);

  const exit = useCallback(() => {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    }
    setIsFullscreen(false);
  }, []);

  return { isFullscreen, enter, exit };
}

export default function VideoDetail() {
  const { id } = useParams<{ id: string }>();
  const playerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, enter: enterFS, exit: exitFS } = useFullscreen(playerRef);

  const { data: video, isLoading, isError } = useGetRecording(id || "", {
    query: { enabled: !!id, queryKey: getGetRecordingQueryKey(id || "") },
  });

  const { data: related, isLoading: relatedLoading } = useListRelatedRecordings(
    { id: id || "", limit: 12 },
    { query: { enabled: !!id } },
  );

  if (isError) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-5" />
          <h1 className="text-lg font-bold mb-2">Recording not found</h1>
          <p className="text-sm text-muted-foreground mb-6">
            This video doesn&apos;t exist or was removed.
          </p>
          <Link
            href="/browse"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Browse
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        {/* Breadcrumb */}
        <Link
          href="/browse"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-6 group"
        >
          <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
          Browse
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* ─── Main column ──────────────────────────────────────── */}
          <div className="space-y-6 min-w-0">
            {/* Player */}
            {isLoading ? (
              <Skeleton className="w-full aspect-video" />
            ) : video ? (
              <div
                ref={playerRef}
                className="relative group aspect-video w-full bg-black overflow-hidden rounded-sm"
              >
                {video.embed_url ? (
                  <iframe
                    src={video.embed_url}
                    className="w-full h-full border-0"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture"
                    title={video.room_title || video.filename}
                  />
                ) : video.thumbnail_url ? (
                  <img
                    src={video.thumbnail_url}
                    alt={video.filename}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Clapperboard className="w-12 h-12 text-muted-foreground/20" />
                  </div>
                )}

                {/* Fullscreen toggle */}
                <button
                  onClick={isFullscreen ? exitFS : enterFS}
                  className="absolute bottom-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white/70 hover:text-white rounded transition-all opacity-0 group-hover:opacity-100"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-3.5 h-3.5" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ) : null}

            {/* Video info */}
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-px w-full" />
              </div>
            ) : video ? (
              <div className="space-y-5">
                {/* Title + performer */}
                <div>
                  <h1 className="text-base sm:text-lg font-bold tracking-tight leading-snug mb-2">
                    {video.room_title || video.filename}
                  </h1>
                  <Link
                    href={`/performers/${video.username}`}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    <User className="w-3.5 h-3.5" />
                    {video.username}
                  </Link>
                </div>

                {/* Metadata strip */}
                <div className="flex flex-wrap gap-3 sm:gap-5 py-4 border-y border-border/40 text-xs text-muted-foreground">
                  {video.viewers != null && video.viewers > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-primary/60" />
                      <strong className="text-foreground">
                        {video.viewers.toLocaleString()}
                      </strong>{" "}
                      viewers
                    </span>
                  )}
                  {video.resolution && (
                    <span className="flex items-center gap-1.5">
                      <MonitorPlay className="w-3.5 h-3.5 text-primary/60" />
                      <strong className="text-foreground">{video.resolution}</strong>
                    </span>
                  )}
                  {video.filesize ? (
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-primary/60" />
                      <strong className="text-foreground">
                        {formatBytes(video.filesize)}
                      </strong>
                    </span>
                  ) : null}
                  {video.timestamp && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-primary/60" />
                      {formatRelativeTime(video.timestamp)}
                    </span>
                  )}
                </div>

                {/* Tags */}
                {video.tags && video.tags.length > 0 && (
                  <div className="space-y-3">
                    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                      <Tag className="w-3 h-3" />
                      Tags
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {video.tags.map((tag) => (
                        <Link
                          key={tag}
                          href={`/browse?tags=${encodeURIComponent(tag)}`}
                        >
                          <span className="inline-block px-2.5 py-1 text-[11px] border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all cursor-pointer rounded-[2px]">
                            {tag}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* More from performer */}
                {video.gender && (
                  <div className="text-xs text-muted-foreground/60 pt-1">
                    <Link
                      href={`/browse?gender=${encodeURIComponent(video.gender)}`}
                      className="hover:text-muted-foreground transition-colors capitalize"
                    >
                      Browse {video.gender} recordings →
                    </Link>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* ─── Sidebar — Related ───────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
              More from {video?.username ?? "this performer"}
            </p>

            {relatedLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-28 aspect-video shrink-0" />
                    <div className="flex-1 space-y-1.5 pt-0.5">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : related && related.filter((r) => r.id !== id).length > 0 ? (
              <div className="space-y-3">
                {related
                  .filter((r) => r.id !== id)
                  .map((rec) => (
                    <Link
                      key={rec.id}
                      href={`/video/${rec.id}`}
                      className="group flex gap-3 outline-none"
                    >
                      <div className="w-28 aspect-video shrink-0 overflow-hidden bg-secondary rounded-[2px]">
                        {rec.thumbnail_url ? (
                          <img
                            src={rec.thumbnail_url}
                            alt={rec.filename}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Clapperboard className="w-4 h-4 text-muted-foreground/20" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                        <h4 className="text-[11px] font-medium line-clamp-2 leading-snug text-foreground/80 group-hover:text-foreground transition-colors">
                          {rec.room_title || rec.filename}
                        </h4>
                        <p className="text-[10px] text-muted-foreground/50">
                          {formatRelativeTime(rec.timestamp)}
                        </p>
                        {rec.resolution && (
                          <p className="text-[10px] text-muted-foreground/40">
                            {rec.resolution}
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}

                {/* Link to performer page */}
                {video?.username && (
                  <Link
                    href={`/performers/${video.username}`}
                    className="block pt-2 text-[11px] text-primary/70 hover:text-primary transition-colors"
                  >
                    All recordings by {video.username} →
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40">
                No related recordings found.
              </p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
