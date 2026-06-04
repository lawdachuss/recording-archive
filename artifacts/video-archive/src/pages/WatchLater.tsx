import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { getWatchLater, removeFromWatchLater, clearWatchLater, type SavedRecording } from "@/lib/bookmarks";
import { Clock, Trash2, ListX } from "lucide-react";

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

export default function WatchLater() {
  const [queue, setQueue] = useState<SavedRecording[]>([]);

  useEffect(() => {
    setQueue(getWatchLater());
  }, []);

  const handleRemove = (id: string) => {
    removeFromWatchLater(id);
    setQueue(getWatchLater());
  };

  const handleClearAll = () => {
    clearWatchLater();
    setQueue([]);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Clock className="w-5 h-5 text-primary" />
              Watch Later
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {queue.length} recording{queue.length !== 1 ? "s" : ""} queued
            </p>
          </div>
          {queue.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-destructive transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear queue
            </button>
          )}
        </div>

        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <ListX className="w-10 h-10 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground/50 mb-1">Queue is empty</p>
            <p className="text-xs text-muted-foreground/30 mb-6">
              Add recordings to watch later from any video page.
            </p>
            <Link href="/browse" className="text-xs text-primary hover:underline">
              Browse recordings →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {queue.map((rec, index) => (
              <div key={rec.id} className="relative group/card">
                {/* Queue number */}
                <div className="absolute top-2 left-2 z-10 w-5 h-5 rounded-[2px] bg-primary/90 text-white text-[10px] font-bold flex items-center justify-center">
                  {index + 1}
                </div>
                <VideoCard
                  recording={toRecording(rec)}
                  showRemove
                  onRemove={() => handleRemove(rec.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
