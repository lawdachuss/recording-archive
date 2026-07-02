import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, type CloudItem } from "@/lib/user-api";
import { CloudSyncIndicator } from "@/components/CloudSyncIndicator";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { Bookmark, Trash2, BookmarkX } from "lucide-react";

function toRecording(r: ReturnType<typeof parseCloudItem>) {
  return {
    id: r.id,
    username: r.username,
    filename: r.filename,
    room_title: r.room_title ?? null,
    thumbnail_url: r.thumbnail_url ?? null,
    sprite_url: r.sprite_url ?? null,
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

export default function Bookmarks() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const recentlyWatched = useRecentlyWatched();

  const { data: cloudItems = [], isLoading } = useQuery({
    queryKey: ["user", "saved"],
    queryFn: () => userApi.getSaved(),
    enabled: !!user,
  });

  const removeCloud = useTrackedMutation({
    mutationFn: (id: string) => userApi.removeSaved(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "saved"] }),
  });

  const handleRemove = (id: string) => {
    removeCloud.mutate(id);
  };

  const handleClearAll = () => {
    cloudItems.forEach((b: CloudItem) => removeCloud.mutate(b.recording_id));
  };

  if (!user) return null;

  const bookmarks = cloudItems.map(parseCloudItem);

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
              <Bookmark className="w-3.5 h-3.5 text-primary" />
              Saved
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Bookmarks</h1>
            <p className="text-sm text-muted-foreground mt-2">
              {bookmarks.length} saved recording{bookmarks.length !== 1 ? "s" : ""}
              <CloudSyncIndicator compact />
            </p>
          </div>
          {bookmarks.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs text-muted-foreground/50 hover:text-destructive border border-border/40 hover:border-destructive/30 rounded-lg transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear all
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="aspect-video bg-secondary/30 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
              <BookmarkX className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-muted-foreground mb-1">No bookmarks yet</p>
            <p className="text-xs text-muted-foreground/40 mb-6 max-w-xs">
              Save recordings by clicking the bookmark icon on any video to access them later.
            </p>
            <Link href="/browse" className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors">
              Browse recordings →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {bookmarks.map((rec, i) => (
              <div key={rec.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 25}ms` }}>
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
