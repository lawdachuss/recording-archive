import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { useAuth } from "@/contexts/AuthContext";
import { getBookmarks, removeBookmark, type SavedRecording } from "@/lib/bookmarks";
import { userApi, parseCloudItem } from "@/lib/user-api";
import { Bookmark, Trash2, BookmarkX } from "lucide-react";

function toRecording(r: SavedRecording) {
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [localBookmarks, setLocalBookmarks] = useState<SavedRecording[]>(() =>
    user ? [] : getBookmarks(),
  );

  const { data: cloudItems = [], isLoading } = useQuery({
    queryKey: ["user", "saved"],
    queryFn: () => userApi.getSaved(),
    enabled: !!user,
  });

  const removeCloud = useMutation({
    mutationFn: (id: string) => userApi.removeSaved(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "saved"] }),
  });

  useEffect(() => {
    if (!user) setLocalBookmarks(getBookmarks());
  }, [user]);

  const bookmarks: SavedRecording[] = user
    ? cloudItems.map(parseCloudItem)
    : localBookmarks;

  const handleRemove = (id: string) => {
    if (user) {
      removeCloud.mutate(id);
    } else {
      removeBookmark(id);
      setLocalBookmarks(getBookmarks());
    }
  };

  const handleClearAll = () => {
    if (user) {
      bookmarks.forEach((b) => removeCloud.mutate(b.id));
    } else {
      bookmarks.forEach((b) => removeBookmark(b.id));
      setLocalBookmarks([]);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Bookmark className="w-5 h-5 text-primary" />
              Bookmarks
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {bookmarks.length} saved recording{bookmarks.length !== 1 ? "s" : ""}
              {user && <span className="text-primary/60 ml-1">· cloud synced</span>}
            </p>
          </div>
          {bookmarks.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-destructive transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear all
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="aspect-video bg-secondary/30 animate-pulse rounded-sm" />
            ))}
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <BookmarkX className="w-10 h-10 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground/50 mb-1">No bookmarks yet</p>
            <p className="text-xs text-muted-foreground/30 mb-6">
              Save recordings to watch later by clicking the bookmark icon on any video.
            </p>
            <Link href="/browse" className="text-xs text-primary hover:underline">
              Browse recordings →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {bookmarks.map((rec) => (
              <VideoCard
                key={rec.id}
                recording={toRecording(rec)}
                showRemove
                onRemove={() => handleRemove(rec.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
