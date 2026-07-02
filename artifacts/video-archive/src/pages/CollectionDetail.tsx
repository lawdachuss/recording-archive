import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, type CloudItem, type CloudCollection } from "@/lib/user-api";
import { CloudSyncIndicator } from "@/components/CloudSyncIndicator";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { ArrowLeft, Film, Pencil, Check, X, Trash2, ListVideo } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";

function toRecording(r: ReturnType<typeof parseCloudItem>) {
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
    framerate: null,
    filesize: null,
    gender: null,
    sprite_url: null,
    embed_url: null,
    preview_url: null,
    instance_id: null,
    updated_at: null,
    channel_id: null,
  };
}

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const { data: cloudCollections = [] } = useQuery({
    queryKey: ["user", "collections"],
    queryFn: () => userApi.getCollections(),
    enabled: !!user,
  });

  const cloudMeta: CloudCollection | undefined = cloudCollections.find(
    (c: CloudCollection) => c.id === id,
  );

  const { data: cloudItems = [], isLoading: cloudLoading } = useQuery({
    queryKey: ["user", "collections", id],
    queryFn: () => userApi.getCollectionItems(id!),
    enabled: !!user && !!id,
  });

  const renameCloud = useTrackedMutation({
    mutationFn: (name: string) => userApi.updateCollection(id!, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
    },
  });

  const removeItemCloud = useTrackedMutation({
    mutationFn: (recordingId: string) =>
      userApi.removeCollectionItem(id!, recordingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "collections", id] });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
    },
  });

  const recentlyWatched = useRecentlyWatched();

  const deleteCloud = useTrackedMutation({
    mutationFn: () => userApi.deleteCollection(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
    },
  });

  const handleRemove = (recordingId: string) => {
    removeItemCloud.mutate(recordingId);
  };

  const handleRename = () => {
    if (!editName.trim()) return;
    renameCloud.mutate(editName.trim());
    setEditing(false);
  };

  if (!user) return null;

  const notFound = !cloudLoading && !cloudMeta;
  const items = cloudItems;
  const collectionName = cloudMeta?.name ?? "Collection";
  const collectionDesc = cloudMeta?.description ?? undefined;
  const collectionCreatedAt = cloudMeta?.created_at;

  const previewThumbnail = (() => {
    const first = items[0];
    if (first?.metadata) {
      try {
        return JSON.parse(first.metadata).thumbnail_url;
      } catch {
        return null;
      }
    }
    return null;
  })();

  if (notFound) {
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
        <Link
          href="/collections"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-6 group"
        >
          <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
          Collections
        </Link>

        <div className="flex items-start gap-4 mb-8 pb-6 border-b border-border/40">
          <div className="w-16 h-16 rounded-sm bg-secondary shrink-0 overflow-hidden">
            {previewThumbnail ? (
              <OptimizedImage
                src={previewThumbnail}
                alt={collectionName}
                className="w-full h-full object-cover"
                containerClassName="w-16 h-16"
                fallback={
                  <div className="w-16 h-16 flex items-center justify-center bg-secondary">
                    <Film className="w-6 h-6 text-muted-foreground/20" />
                  </div>
                }
              />
            ) : (
              <div className="w-16 h-16 flex items-center justify-center bg-secondary">
                <Film className="w-6 h-6 text-muted-foreground/20" />
              </div>
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditing(false);
                  }}
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
                <h1 className="text-xl sm:text-2xl font-black tracking-tighter">{collectionName}</h1>
                <button
                  onClick={() => { setEditing(true); setEditName(collectionName); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Rename collection"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {collectionDesc && (
              <p className="text-sm text-muted-foreground mb-1">{collectionDesc}</p>
            )}
            <p className="text-xs text-muted-foreground/60">
              {items.length} {items.length === 1 ? "video" : "videos"}
              {collectionCreatedAt && (
                <> · Created {formatRelativeTime(collectionCreatedAt)}</>
              )}
              <CloudSyncIndicator compact />
            </p>
          </div>

          <button
            onClick={async () => {
              if (!confirm("Delete this collection? This cannot be undone.")) return;
              await deleteCloud.mutateAsync();
              setLocation("/collections");
            }}
            className="shrink-0 flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-muted-foreground/50 hover:text-destructive border border-border/40 hover:border-destructive/40 rounded-sm transition-all"
            title="Delete collection"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </button>
        </div>

        {cloudLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-video bg-secondary/30 animate-pulse rounded-sm" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-border/40 rounded-sm">
            <Film className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No videos in this collection yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Open any video and use the "Add to Collection" button.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {items.map((item: CloudItem) => {
              const rec = parseCloudItem(item);
              return (
                <div key={rec.id} className="relative group/card">
                  <VideoCard recording={toRecording(rec)} isWatched={recentlyWatched.has(rec.id)} />
                  <button
                    onClick={() => handleRemove(rec.id)}
                    className="absolute top-2 left-2 z-10 w-6 h-6 flex items-center justify-center bg-black/30 backdrop-blur-sm ring-1 ring-white/10 text-white/60 hover:text-red-400 hover:bg-red-600/60 hover:ring-red-600/30 transition-all rounded opacity-0 group-hover/card:opacity-100"
                    title="Remove from collection"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
