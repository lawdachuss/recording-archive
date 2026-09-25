import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { Layout } from "@/components/Layout";
import { AdBanner } from "@/components/ads/AdBanner";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { VideoCard } from "@/components/VideoCard";
import { AdGridCard } from "@/components/ads/AdGridCard";
import { isAdCard } from "@/lib/ad-creatives";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, type CloudItem, type CloudCollection } from "@/lib/user-api";
import { CloudSyncIndicator } from "@/components/CloudSyncIndicator";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { usePreloadRecordings } from "@/hooks/use-preload-recordings";
import { setQueue, shuffleQueueItems, toQueueItem, type QueueItem } from "@/lib/play-queue";
import { byPositionThenNewest, moveItem } from "@/lib/list-order";
import { trackActivity } from "@/lib/rum";
import { cn } from "@/lib/utils";
import { ArrowLeft, Film, Pencil, Check, X, Trash2, ListVideo, Play, Shuffle, GripVertical } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";
import { proxyUrl } from "@/lib/proxy-url";

function toRecording(r: ReturnType<typeof parseCloudItem>) {
  return {
    id: r.id,
    username: r.username,
    filename: r.filename,
    room_title: r.room_title ?? null,
    thumbnail_url: r.thumbnail_url ?? null,
    sprite_url: r.sprite_url ?? null,
    resolution: r.resolution ?? null,
    duration: r.duration ?? null,
    timestamp: r.timestamp,
    created_at: r.saved_at,
    tags: [] as string[],
    viewers: null,
    framerate: null,
    filesize: null,
    gender: null,
    embed_url: null,
    preview_url: r.preview_url ?? null,
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
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  // Optimistic drag order (recording ids). Null = render pure server order.
  // Set on drop, cleared when the reorder mutation settles.
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const { data: cloudCollections = [], isLoading: collectionsLoading } = useQuery({
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

  const updateMeta = useTrackedMutation({
    mutationFn: (payload: { name?: string; description?: string | null }) =>
      userApi.updateCollection(id!, payload.name ?? cloudMeta?.name ?? "Collection", payload.description),
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
    updateMeta.mutate({ name: editName.trim() });
    setEditing(false);
  };

  const handleDescSave = () => {
    updateMeta.mutate({ description: editDesc.trim() ? editDesc.trim() : null });
    setEditingDesc(false);
  };

  // Server order (migration 013: position, then newest-first for unranked),
  // overlaid with the optimistic drag order while a reorder is in flight.
  type CloudItemWithId = CloudItem & { id: string };
  const sortedItems = useMemo<CloudItemWithId[]>(() => {
    // byPositionThenNewest keys on `id`; cloud items key on `recording_id`.
    const wrapped: CloudItemWithId[] = cloudItems.map((it) => ({ ...it, id: it.recording_id }));
    const sorted = wrapped.sort(byPositionThenNewest);
    if (!order) return sorted;
    const byId = new Map(sorted.map((it) => [it.recording_id, it]));
    const arranged = order
      .map((rid) => byId.get(rid))
      .filter((it): it is CloudItemWithId => !!it);
    const fresh = sorted.filter((it) => !order.includes(it.recording_id)); // added mid-drag
    return [...arranged, ...fresh];
  }, [cloudItems, order]);

  // Persist a new order: optimistic UI first, server renumbers atomically.
  const commitOrder = (ids: string[]) => {
    setOrder(ids);
    reorderCloud.mutate(ids);
  };

  const reorderCloud = useTrackedMutation({
    mutationFn: (recording_ids: string[]) => userApi.reorderCollectionItems(id!, recording_ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "collections", id] });
      setOrder(null);
    },
    onError: () => {
      setOrder(null); // revert to server order
    },
  });

  const handleDragStart = (recId: string) => (e: React.DragEvent) => {
    setDragId(recId);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", recId);
    } catch {
      /* some engines forbid setData — state above is what drives the drop */
    }
  };

  const handleDragOver = (recId: string) => (e: React.DragEvent) => {
    if (!dragId || dragId === recId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropTarget((prev) => (prev?.id === recId && prev.after === after ? prev : { id: recId, after }));
  };

  const handleDropOn = (recId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const after = dropTarget?.id === recId ? dropTarget.after : false;
    if (dragId && dragId !== recId) {
      const base = sortedItems.map((it) => it.recording_id);
      const next = moveItem(base, dragId, recId, after);
      if (next !== base) {
        commitOrder(next);
        trackActivity("collection_reorder", { meta: { collection_id: id, count: next.length } });
      }
    }
    setDragId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  // Warm thumbnails, sprites, and animated previews for every recording in the
  // collection the moment the page has them — hovering any card later is instant.
  usePreloadRecordings(cloudItems.map(parseCloudItem));

  if (!user) return null;

  const notFound = !collectionsLoading && !cloudLoading && !cloudMeta;
  const items = sortedItems;
  const collectionName = cloudMeta?.name ?? "Collection";
  const collectionDesc = cloudMeta?.description ?? undefined;
  const collectionCreatedAt = cloudMeta?.created_at;

  const previewThumbnail = (() => {
    const first = items[0];
    if (first?.metadata) {
      try {
        return proxyUrl(JSON.parse(first.metadata).thumbnail_url);
      } catch {
        return null;
      }
    }
    return null;
  })();

  /** Usable queue items for the collection (invalid shapes dropped). */
  const listItems = (): QueueItem[] =>
    cloudItems.map((it) => toQueueItem(parseCloudItem(it))).filter((it): it is QueueItem => it !== null);

  /**
   * Start playback from a list of items. Marks the arrival as queue-driven
   * (vauto) so the player auto-starts — same continuous-playback contract as
   * the Playlists page.
   */
  const startQueue = (title: string, items: QueueItem[], startIndex = 0) => {
    setQueue(title, items);
    sessionStorage.setItem("vauto", items[startIndex].id);
    window.scrollTo({ top: 0, behavior: "auto" });
    setLocation(`/video/${items[startIndex].id}`);
  };

  /** Queue the whole collection and start playback from its first recording. */
  const handlePlayAll = () => {
    const queueItems = listItems();
    if (queueItems.length === 0) return;
    trackActivity("playlist_start", { meta: { mix: "collection", count: queueItems.length, index: 0, order: "sequential" } });
    startQueue(collectionName, queueItems);
  };

  /** Shuffle the whole collection and start from a random recording. */
  const handleShuffle = () => {
    const queueItems = listItems();
    if (queueItems.length === 0) return;
    const startId = queueItems[Math.floor(Math.random() * queueItems.length)].id;
    const shuffled = shuffleQueueItems(queueItems, startId);
    trackActivity("playlist_start", { meta: { mix: "collection", count: shuffled.length, index: 0, order: "shuffle" } });
    startQueue(collectionName, shuffled);
  };

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
            {editingDesc ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  autoFocus
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleDescSave();
                    if (e.key === "Escape") setEditingDesc(false);
                  }}
                  maxLength={200}
                  placeholder="Description (optional)"
                  className="h-8 bg-background border border-primary/50 rounded-sm px-2.5 text-sm outline-none flex-1 max-w-sm"
                />
                <button onClick={handleDescSave} className="text-green-500 hover:text-green-400 transition-colors" title="Save description">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setEditingDesc(false)} className="text-muted-foreground hover:text-foreground transition-colors" title="Cancel">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setEditingDesc(true); setEditDesc(collectionDesc ?? ""); }}
                className="group/desc flex items-center gap-1.5 mb-1 text-left min-w-0"
                title="Edit description"
              >
                {collectionDesc ? (
                  <p className="text-sm text-muted-foreground truncate">{collectionDesc}</p>
                ) : (
                  <p className="text-xs text-muted-foreground/40 italic">Add a description…</p>
                )}
                <Pencil className="w-3 h-3 shrink-0 text-muted-foreground/0 group-hover/desc:text-muted-foreground transition-colors" />
              </button>
            )}
            <p className="text-xs text-muted-foreground/60">
              {items.length} {items.length === 1 ? "video" : "videos"}
              {collectionCreatedAt && (
                <> · Created {formatRelativeTime(collectionCreatedAt)}</>
              )}
              <CloudSyncIndicator compact />
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {items.length > 0 && (
              <>
                <button
                  onClick={handleShuffle}
                  className="flex items-center gap-1.5 h-9 px-2.5 text-xs font-medium border border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary transition-all rounded-sm"
                  title="Shuffle play"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Shuffle</span>
                </button>
                <button
                  onClick={handlePlayAll}
                  className="flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-all rounded-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  Play all
                </button>
              </>
            )}
            <button
              onClick={async () => {
                if (!confirm("Delete this collection? This cannot be undone.")) return;
                try {
                  await deleteCloud.mutateAsync();
                  setLocation("/collections");
                } catch {
                  // Delete failed — stay on page so user can retry
                }
              }}
              className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-muted-foreground/50 hover:text-destructive border border-border/40 hover:border-destructive/40 rounded-sm transition-all"
              title="Delete collection"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          </div>
        </div>

        {/* Top ad — 728×90 / 468×60 / 300×100 */}
        <AdLeaderboard className="mb-8" />

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
            {items.map((item: CloudItem, i) => {
              const rec = parseCloudItem(item);
              const isDragging = dragId === rec.id;
              const dropHere = dropTarget?.id === rec.id ? dropTarget : null;
              return (
                <Fragment key={rec.id}>
                  <div
                    className={cn("relative group/card", isDragging && "opacity-40")}
                    draggable
                    onDragStart={handleDragStart(rec.id)}
                    onDragOver={handleDragOver(rec.id)}
                    onDrop={handleDropOn(rec.id)}
                    onDragEnd={handleDragEnd}
                    onDragLeave={() => setDropTarget((prev) => (prev?.id === rec.id ? null : prev))}
                  >
                    <VideoCard recording={toRecording(rec)} isWatched={recentlyWatched.has(rec.id)} />
                    {/* Playlist position — the order "Play all" follows. */}
                    <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
                      <div className="w-6 h-6 rounded-lg border border-primary/40 text-primary text-[10px] font-bold flex items-center justify-center bg-black/40 backdrop-blur-sm">
                        {i + 1}
                      </div>
                      <button
                        onClick={() => handleRemove(rec.id)}
                        className="w-6 h-6 flex items-center justify-center bg-black/30 backdrop-blur-sm ring-1 ring-white/10 text-white/60 hover:text-red-400 hover:bg-red-600/60 hover:ring-red-600/30 transition-all rounded opacity-0 group-hover/card:opacity-100"
                        title="Remove from collection"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div
                      className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center bg-black/30 backdrop-blur-sm ring-1 ring-white/10 text-white/60 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover/card:opacity-100 transition-all pointer-events-none"
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                    {dropHere && (
                      <div
                        className={cn(
                          "absolute z-20 left-1 right-1 h-0.5 bg-primary rounded-full pointer-events-none",
                          dropHere.after ? "-bottom-1" : "-top-1",
                        )}
                      />
                    )}
                  </div>
                  {isAdCard(items, i) && <AdGridCard />}
                </Fragment>
              );
            })}
          </div>
        )}
        {/* Bottom ad — 300×250 medium rectangle */}
        <div className="mt-10 flex justify-center">
          <AdBanner file="medium-rect-300x250" />
        </div>
      </div>
    </Layout>
  );
}
