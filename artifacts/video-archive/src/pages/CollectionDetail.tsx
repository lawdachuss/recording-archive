import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import {
  getCollection,
  removeFromCollection,
  renameCollection,
  type Collection,
} from "@/lib/collections";
import { ArrowLeft, Film, Pencil, Check, X, Trash2, ListVideo } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const [collection, setCollection] = useState<Collection | undefined>();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (id) {
      const col = getCollection(id);
      setCollection(col);
      setEditName(col?.name ?? "");
    }
  }, [id]);

  const handleRemove = (recordingId: string) => {
    if (!id) return;
    removeFromCollection(id, recordingId);
    setCollection((prev) =>
      prev ? { ...prev, items: prev.items.filter((r) => r.id !== recordingId) } : prev,
    );
  };

  const handleRename = () => {
    if (!id || !editName.trim()) return;
    renameCollection(id, editName.trim());
    setCollection((prev) => (prev ? { ...prev, name: editName.trim() } : prev));
    setEditing(false);
  };

  if (!collection) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 text-center">
          <ListVideo className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-4">Collection not found</p>
          <Link href="/collections" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <ArrowLeft className="w-3 h-3" /> Back to Collections
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-7xl">
        {/* Back nav */}
        <Link
          href="/collections"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-6 group"
        >
          <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
          Collections
        </Link>

        {/* Header */}
        <div className="flex items-start gap-4 mb-8">
          <div className="w-16 h-16 rounded-sm bg-secondary shrink-0 overflow-hidden flex items-center justify-center">
            {collection.items[0]?.thumbnail_url ? (
              <img
                src={collection.items[0].thumbnail_url}
                alt={collection.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <Film className="w-6 h-6 text-muted-foreground/20" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  autoFocus
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditing(false); }}
                  maxLength={80}
                  className="h-9 bg-background border border-primary/50 rounded-sm px-3 text-sm font-bold outline-none flex-1 max-w-xs"
                />
                <button onClick={handleRename} className="text-green-500 hover:text-green-400 transition-colors">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl sm:text-2xl font-black tracking-tighter">{collection.name}</h1>
                <button
                  onClick={() => setEditing(true)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Rename collection"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {collection.description && (
              <p className="text-sm text-muted-foreground mb-1">{collection.description}</p>
            )}
            <p className="text-xs text-muted-foreground/60">
              {collection.items.length} {collection.items.length === 1 ? "video" : "videos"} · Created {formatRelativeTime(collection.created_at)}
            </p>
          </div>
        </div>

        {/* Videos */}
        {collection.items.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-border/40 rounded-sm">
            <Film className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No videos in this collection yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Open any video and use the "Add to Collection" button.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {collection.items.map((rec) => (
              <div key={rec.id} className="relative group/card">
                <VideoCard
                  recording={{
                    id: rec.id,
                    username: rec.username,
                    filename: rec.filename,
                    room_title: rec.room_title ?? null,
                    thumbnail_url: rec.thumbnail_url ?? null,
                    resolution: rec.resolution ?? null,
                    timestamp: rec.timestamp,
                    created_at: rec.saved_at,
                    tags: [],
                    viewers: null,
                    framerate: null,
                    filesize: null,
                    gender: null,
                    sprite_url: null,
                    embed_url: null,
                    preview_url: null,
                    instance_id: null,
                    updated_at: null,
                    channel_id: null,
                  }}
                />
                <button
                  onClick={() => handleRemove(rec.id)}
                  className="absolute top-2 left-2 z-10 w-6 h-6 flex items-center justify-center bg-black/80 text-white/60 hover:text-red-400 hover:bg-black transition-all rounded opacity-0 group-hover/card:opacity-100"
                  title="Remove from collection"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
