import { useParams, Link } from "wouter";
import { useGetRecording, useListRelatedRecordings, getGetRecordingQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";
import { Eye, Clock, HardDrive, MonitorPlay, Calendar, Share2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VideoDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: video, isLoading, isError } = useGetRecording(id || "", {
    query: {
      enabled: !!id,
      queryKey: getGetRecordingQueryKey(id || "")
    }
  });

  const { data: related, isLoading: relatedLoading } = useListRelatedRecordings(
    { id: id || "", limit: 10 },
    { query: { enabled: !!id } }
  );

  if (isError) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center">
          <div className="inline-flex items-center justify-center p-4 bg-destructive/10 rounded-full text-destructive mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Recording not found</h1>
          <p className="text-muted-foreground mb-6">The video you're looking for doesn't exist or was removed.</p>
          <Link href="/browse">
            <Button variant="outline">Back to Browse</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {isLoading ? (
              <Skeleton className="w-full aspect-video rounded-2xl" />
            ) : video ? (
              <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black ring-1 ring-border/50 shadow-2xl relative isolate group">
                {video.embed_url ? (
                  <iframe 
                    src={video.embed_url} 
                    className="w-full h-full border-0 absolute inset-0"
                    allowFullScreen 
                    allow="autoplay; fullscreen"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center relative">
                    {video.thumbnail_url && (
                      <>
                        <img src={video.thumbnail_url} alt={video.filename} className="absolute inset-0 w-full h-full object-cover blur-sm opacity-50 scale-105" />
                        <img src={video.thumbnail_url} alt={video.filename} className="relative z-10 max-h-full object-contain drop-shadow-2xl" />
                      </>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-black/80 text-white px-6 py-4 rounded-xl backdrop-blur-md flex items-center gap-3">
                        <AlertCircle className="w-6 h-6 text-yellow-500" />
                        <span className="font-medium">Video player unavailable for this recording</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-3/4" />
                <div className="flex gap-4">
                  <Skeleton className="h-10 w-32 rounded-full" />
                  <Skeleton className="h-10 w-32 rounded-full" />
                </div>
              </div>
            ) : video ? (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">
                      {video.room_title || video.filename}
                    </h1>
                    <div className="flex items-center gap-3 text-lg">
                      <Link href={`/performers/${video.username}`} className="font-semibold text-primary hover:text-primary/80 transition-colors">
                        {video.username}
                      </Link>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="rounded-full bg-secondary/50">
                      <Share2 className="w-4 h-4 mr-2" /> Share
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-3 p-4 bg-card rounded-xl border border-border/50 text-sm text-muted-foreground">
                  {video.viewers !== null && (
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      <span><strong className="text-foreground">{video.viewers.toLocaleString()}</strong> viewers</span>
                    </div>
                  )}
                  {video.timestamp && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span className="text-foreground font-medium">{formatRelativeTime(video.timestamp)}</span>
                    </div>
                  )}
                  {video.resolution && (
                    <div className="flex items-center gap-2">
                      <MonitorPlay className="w-4 h-4" />
                      <span className="text-foreground font-medium">{video.resolution}</span>
                    </div>
                  )}
                  {video.filesize && (
                    <div className="flex items-center gap-2">
                      <HardDrive className="w-4 h-4" />
                      <span className="text-foreground font-medium">{formatBytes(video.filesize)}</span>
                    </div>
                  )}
                  {video.created_at && (
                    <div className="flex items-center gap-2" title={new Date(video.created_at).toLocaleString()}>
                      <Calendar className="w-4 h-4" />
                      <span>Archived {formatRelativeTime(video.created_at)}</span>
                    </div>
                  )}
                </div>

                {video.tags && video.tags.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {video.tags.map(tag => (
                        <Link key={tag} href={`/browse?tags=${encodeURIComponent(tag)}`}>
                          <Badge variant="secondary" className="hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer text-sm py-1 px-3">
                            {tag}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <h3 className="text-xl font-bold tracking-tight">Related Recordings</h3>
            
            {relatedLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-40 aspect-video rounded-lg shrink-0" />
                    <div className="space-y-2 flex-1 py-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : related && related.length > 0 ? (
              <div className="space-y-4">
                {related.filter(r => r.id !== id).map(rec => (
                  <Link key={rec.id} href={`/video/${rec.id}`} className="group flex gap-3 overflow-hidden outline-none">
                    <div className="w-40 aspect-video rounded-lg shrink-0 overflow-hidden relative bg-muted">
                      <img 
                        src={rec.thumbnail_url || ''} 
                        alt={rec.filename} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        loading="lazy"
                      />
                      {rec.resolution && (
                        <span className="absolute bottom-1 right-1 px-1 rounded bg-black/80 text-[9px] font-bold text-white uppercase">
                          {rec.resolution}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 py-1 flex flex-col justify-between">
                      <h4 className="font-semibold text-sm line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                        {rec.room_title || rec.filename}
                      </h4>
                      <div className="text-xs text-muted-foreground mt-1">
                        <div className="font-medium text-foreground/80 mb-0.5">{rec.username}</div>
                        <div>{formatRelativeTime(rec.timestamp)}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No related recordings found.</p>
            )}
          </div>

        </div>
      </div>
    </Layout>
  );
}
