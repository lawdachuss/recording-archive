import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem } from "@/lib/user-api";
import { CloudSyncIndicator } from "@/components/CloudSyncIndicator";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { Clock, Trash2, ListX } from "lucide-react";

function toRecording(r: ReturnType<typeof parseCloudItem>) {
  return {
    id: r.id,
    username: r.username,
    filename: r.filename,
    room_title: r.room_title ?? null,
    thumbnail_url: r.thumbnail_url ?? null,
    preview_url: r.preview_url ?? null,
    resolution: r.resolution ?? null,
    timestamp: r.timestamp,
    created_at: r.saved_at,
    tags: [] as string[],
    viewers: null,
    framerate: null,
    filesize: null,
    gender: null,
    embed_url: null,
    instance_id: null,
    channel_id: null,
    updated_at: null,
  };
}

export default function WatchLater() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const { data: cloudItems = [], isLoading } = useQuery({
    queryKey: ["user", "watch-later"],
    queryFn: () => userApi.getWatchLater(),
    enabled: !!user,
  });

  const recentlyWatched = useRecentlyWatched();

  const removeCloud = useTrackedMutation({
    mutationFn: (id: string) => userApi.removeWatchLater(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "watch-later"] }),
  });

  const clearCloud = useTrackedMutation({
    mutationFn: () => userApi.clearWatchLater(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "watch-later"] }),
  });

  const handleRemove = (id: string) => {
    removeCloud.mutate(id);
  };

  const handleClearAll = () => {
    clearCloud.mutate();
  };

  if (!user) return null;

  const queue = cloudItems.map(parseCloudItem);

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
              <Clock className="w-3.5 h-3.5 text-primary" />
              Queue
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Watch Later</h1>
            <p className="text-sm text-muted-foreground mt-2">
              {queue.length} recording{queue.length !== 1 ? "s" : ""} queued
              <CloudSyncIndicator compact />
            </p>
          </div>
          {queue.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs text-muted-foreground/50 hover:text-destructive border border-border/40 hover:border-destructive/30 rounded-lg transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear queue
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="aspect-video bg-secondary/30 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
              <ListX className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-muted-foreground mb-1">Queue is empty</p>
            <p className="text-xs text-muted-foreground/40 mb-6 max-w-xs">
              Add recordings to watch later from any video page to build your queue.
            </p>
            <Link href="/browse" className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors">
              Browse recordings →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {queue.map((rec, index) => (
              <div key={rec.id} className="relative group/card animate-fade-in-up" style={{ animationDelay: `${index * 20}ms` }}>
                <div className="absolute top-2 left-2 z-10 w-6 h-6 rounded-lg border border-primary/40 text-primary text-[10px] font-bold flex items-center justify-center">
                  {index + 1}
                </div>
                <VideoCard
                  recording={toRecording(rec)}
                  showRemove
                  onRemove={() => handleRemove(rec.id)}
                  isWatched={recentlyWatched.has(rec.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
