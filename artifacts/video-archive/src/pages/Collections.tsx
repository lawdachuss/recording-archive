import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { Layout } from "@/components/Layout";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type CloudCollection } from "@/lib/user-api";
import { CloudSyncIndicator } from "@/components/CloudSyncIndicator";
import {
  FolderOpen, Plus, Trash2, Film, ListVideo, ChevronRight,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";

export default function Collections() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const { data: cloudCollections = [], isLoading } = useQuery({
    queryKey: ["user", "collections"],
    queryFn: () => userApi.getCollections(),
    enabled: !!user,
  });

  const deleteCloud = useTrackedMutation({
    mutationFn: (id: string) => userApi.deleteCollection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "collections"] }),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    await userApi.createCollection(newName.trim(), newDesc.trim() || undefined);
    queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
    setCreating(false);
  };

  const handleDelete = (id: string) => {
    deleteCloud.mutate(id);
  };

  if (!user) return null;

  const collections = cloudCollections.map((col: CloudCollection) => ({
    id: col.id,
    name: col.name,
    description: col.description ?? undefined,
    item_count: col.item_count ?? 0,
    thumbnail: col.first_item_metadata
      ? (() => {
          try {
            return JSON.parse(col.first_item_metadata).thumbnail_url;
          } catch {
            return null;
          }
        })()
      : null,
    created_at: col.created_at,
  }));

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
              <ListVideo className="w-3.5 h-3.5 text-primary" />
              Collections
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">
              My Collections
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Organize recordings into named playlists
              <CloudSyncIndicator compact />
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors shrink-0 rounded-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Collection
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 p-5 border border-primary/30 bg-primary/5 rounded-xl space-y-3 animate-fade-in-up"
          >
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              New Collection
            </p>
            <div className="space-y-2">
              <input
                autoFocus
                type="text"
                placeholder="Collection name *"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                required
                className="w-full h-10 bg-background border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/5"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={200}
                className="w-full h-10 bg-background border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/5"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }}
                className="h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground transition-colors rounded-lg"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-secondary/30 border border-border/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : collections.length === 0 ? (
          <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-muted-foreground mb-1">No collections yet</p>
            <p className="text-xs text-muted-foreground/60 mb-6 max-w-xs mx-auto">
              Create a collection and add recordings to it from any video page.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              New Collection
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {collections.map((col, i) => (
              <div
                key={col.id}
                className="flex items-center gap-4 border border-border/40 hover:border-primary/30 rounded-xl transition-all duration-200 group bg-card hover:bg-secondary animate-fade-in-up"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="w-20 h-14 shrink-0 bg-secondary rounded-l-xl overflow-hidden">
                  {col.thumbnail ? (
                    <OptimizedImage
                      src={col.thumbnail}
                      alt={col.name}
                      className="w-full h-full object-cover"
                      containerClassName="w-20 h-14"
                      fallback={
                        <div className="w-20 h-14 flex items-center justify-center bg-secondary">
                          <Film className="w-5 h-5 text-muted-foreground/20" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="w-20 h-14 flex items-center justify-center bg-secondary">
                      <Film className="w-5 h-5 text-muted-foreground/20" />
                    </div>
                  )}
                </div>

                <Link href={`/collections/${col.id}`} className="flex-1 min-w-0 py-3 pr-2">
                  <div className="text-sm font-semibold group-hover:text-primary transition-colors truncate">
                    {col.name}
                  </div>
                  {col.description && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{col.description}</div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/60">
                    <span className="tabular-nums">{col.item_count} {col.item_count === 1 ? "video" : "videos"}</span>
                    <span className="w-px h-3 bg-border/30" />
                    <span>{formatRelativeTime(col.created_at)}</span>
                  </div>
                </Link>

                <div className="flex items-center gap-1 pr-3 shrink-0">
                  <Link href={`/collections/${col.id}`}>
                    <span className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all rounded-lg">
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </Link>
                  <button
                    onClick={() => handleDelete(col.id)}
                    className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all rounded-lg"
                    title="Delete collection"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
