import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { useAuth } from "@/contexts/AuthContext";
import { getHistory, clearHistory, type SavedRecording } from "@/lib/bookmarks";
import { userApi, parseCloudItem } from "@/lib/user-api";
import { History as HistoryIcon, Trash2, Clock } from "lucide-react";

function toRecording(r: SavedRecording) {
  return {
    id: r.id,
    username: r.username,
    filename: r.filename,
    room_title: r.room_title ?? null,
    thumbnail_url: r.thumbnail_url ?? null,
    resolution: r.resolution ?? null,
    timestamp: r.timestamp,
    created_at: r.saved_at,
    tags: [] as string[],
    viewers: null,
    preview_url: null,
    framerate: null,
    filesize: null,
    gender: null,
    sprite_url: null,
    embed_url: null,
    instance_id: null,
    channel_id: null,
    updated_at: null,
  };
}

export default function History() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [localHistory, setLocalHistory] = useState<SavedRecording[]>(() =>
    user ? [] : getHistory(),
  );

  const { data: cloudItems = [], isLoading } = useQuery({
    queryKey: ["user", "history"],
    queryFn: () => userApi.getHistory(),
    enabled: !!user,
  });

  const clearCloud = useMutation({
    mutationFn: () => userApi.clearHistory(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "history"] }),
  });

  useEffect(() => {
    if (!user) setLocalHistory(getHistory());
  }, [user]);

  const history: SavedRecording[] = user
    ? cloudItems.map(parseCloudItem)
    : localHistory;

  const handleClear = () => {
    if (user) {
      clearCloud.mutate();
    } else {
      clearHistory();
      setLocalHistory([]);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <HistoryIcon className="w-5 h-5 text-primary" />
              Watch History
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {history.length} recording{history.length !== 1 ? "s" : ""} watched
              {user && <span className="text-primary/60 ml-1">· cloud synced</span>}
            </p>
          </div>
          {history.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-destructive transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear history
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="aspect-video bg-secondary/30 animate-pulse rounded-sm" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <Clock className="w-10 h-10 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground/50 mb-1">No watch history</p>
            <p className="text-xs text-muted-foreground/30 mb-6">
              Videos you watch will appear here automatically.
            </p>
            <Link href="/browse" className="text-xs text-primary hover:underline">
              Browse recordings →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {history.map((rec) => (
              <VideoCard key={rec.id} recording={toRecording(rec)} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
