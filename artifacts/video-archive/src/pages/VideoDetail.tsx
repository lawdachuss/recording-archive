import { useParams, Link } from "wouter";
import { useGetRecording, useListRelatedRecordings, getGetRecordingQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";
import { Eye, HardDrive, MonitorPlay, AlertCircle, ArrowLeft } from "lucide-react";

export default function VideoDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: video, isLoading, isError } = useGetRecording(id || "", {
    query: { enabled: !!id, queryKey: getGetRecordingQueryKey(id || "") },
  });

  const { data: related } = useListRelatedRecordings(
    { id: id || "", limit: 8 },
    { query: { enabled: !!id } }
  );

  if (isError) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-20 text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Recording not found</h1>
          <p className="text-sm text-muted-foreground mb-6">This video doesn't exist or was removed.</p>
          <Link href="/browse" className="text-sm text-primary hover:underline">
            ← Back to Browse
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
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Browse
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
          {/* Main */}
          <div className="space-y-5">
            {/* Player */}
            {isLoading ? (
              <Skeleton className="w-full aspect-video" />
            ) : video ? (
              <div className="aspect-video w-full bg-black overflow-hidden">
                {video.embed_url ? (
                  <iframe
                    src={video.embed_url}
                    className="w-full h-full border-0"
                    allowFullScreen
                    allow="autoplay; fullscreen"
                  />
                ) : video.thumbnail_url ? (
                  <img
                    src={video.thumbnail_url}
                    alt={video.filename}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
              </div>
            ) : null}

            {/* Info */}
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : video ? (
              <div className="space-y-5">
                <div>
                  <h1 className="text-lg font-bold tracking-tight leading-snug mb-1.5">
                    {video.room_title || video.filename}
                  </h1>
                  <Link
                    href={`/performers/${video.username}`}
                    className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    {video.username}
                  </Link>
                </div>

                {/* Metadata strip */}
                <div className="flex flex-wrap gap-4 py-4 border-y border-border/50 text-xs text-muted-foreground">
                  {video.viewers !== null && (
                    <span className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      <strong className="text-foreground">{video.viewers.toLocaleString()}</strong> viewers
                    </span>
                  )}
                  {video.resolution && (
                    <span className="flex items-center gap-1.5">
                      <MonitorPlay className="w-3.5 h-3.5" />
                      <strong className="text-foreground">{video.resolution}</strong>
                    </span>
                  )}
                  {video.filesize && (
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5" />
                      <strong className="text-foreground">{formatBytes(video.filesize)}</strong>
                    </span>
                  )}
                  {video.timestamp && (
                    <span className="text-muted-foreground/70">
                      Recorded {formatRelativeTime(video.timestamp)}
                    </span>
                  )}
                </div>

                {/* Tags */}
                {video.tags && video.tags.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">Tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {video.tags.map((tag) => (
                        <Link key={tag} href={`/browse?tags=${encodeURIComponent(tag)}`}>
                          <span className="inline-block px-2.5 py-1 text-xs border border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer">
                            {tag}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
              Related
            </p>
            {related && related.length > 0 ? (
              <div className="space-y-4">
                {related
                  .filter((r) => r.id !== id)
                  .map((rec) => (
                    <Link
                      key={rec.id}
                      href={`/video/${rec.id}`}
                      className="group flex gap-3 outline-none"
                    >
                      <div className="w-28 aspect-video shrink-0 overflow-hidden bg-secondary">
                        {rec.thumbnail_url && (
                          <img
                            src={rec.thumbnail_url}
                            alt={rec.filename}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h4 className="text-xs font-medium line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                          {rec.room_title || rec.filename}
                        </h4>
                        <p className="text-[11px] text-muted-foreground mt-1">{rec.username}</p>
                      </div>
                    </Link>
                  ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">No related recordings.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
