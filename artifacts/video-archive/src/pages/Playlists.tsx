import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { AdBanner } from "@/components/ads/AdBanner";
import { StackedPlaylistCard } from "@/components/StackedPlaylistCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type PublicPlaylist } from "@/lib/user-api";
import { trackActivity } from "@/lib/rum";
import { ListVideo, Plus, Clapperboard, FolderHeart } from "lucide-react";

function PlaylistSkeleton() {
  return (
    <div className="space-y-3 p-3 rounded-2xl border border-border/30 bg-card/40">
      <Skeleton className="w-full aspect-video rounded-xl" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export default function Playlists() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Fetch all public user-created playlists
  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ["public-playlists"],
    queryFn: () => userApi.getPublicPlaylists(),
    staleTime: 30_000,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setLocation("/login");
      return;
    }
    if (!newName.trim()) return;

    setCreating(true);
    try {
      const col = await userApi.createCollection(newName.trim(), newDesc.trim() || undefined);
      trackActivity("collection_create", { meta: { name: newName.trim().slice(0, 100) } });
      queryClient.invalidateQueries({ queryKey: ["public-playlists"] });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      setLocation(`/collections/${col.id}`);
    } catch {
      // Error handled gracefully
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
              <ListVideo className="w-3.5 h-3.5 text-primary" />
              Community Playlists
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Playlists</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Explore user-created playlists across the community. Create yours and share it with everyone!
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {user && (
              <Link
                href="/collections"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium border border-border/60 text-muted-foreground hover:text-foreground transition-colors rounded-lg"
              >
                <FolderHeart className="w-3.5 h-3.5" />
                My Playlists
              </Link>
            )}
            <button
              onClick={() => {
                if (!user) {
                  setLocation("/login");
                } else {
                  setShowCreate((v) => !v);
                }
              }}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Playlist
            </button>
          </div>
        </div>

        {/* Top ad leaderboard */}
        <AdLeaderboard className="mb-8" />

        {/* Create Playlist Inline Form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-8 p-5 border border-primary/30 bg-primary/5 rounded-2xl space-y-3 animate-fade-in-up"
          >
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Create New Public Playlist
            </p>
            <div className="space-y-2">
              <input
                autoFocus
                type="text"
                placeholder="Playlist name *"
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
                className="h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg disabled:opacity-60 cursor-pointer"
              >
                {creating ? "Creating…" : "Create & Add Videos"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                  setNewDesc("");
                }}
                className="h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground transition-colors rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Content Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <PlaylistSkeleton key={i} />
            ))}
          </div>
        ) : playlists.length === 0 ? (
          <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Clapperboard className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <h3 className="text-base font-bold mb-1">No playlists created yet</h3>
            <p className="text-xs text-muted-foreground mb-6 max-w-sm mx-auto">
              Be the first to build a custom playlist from the archive! Everyone will be able to see and play it here.
            </p>
            <button
              onClick={() => {
                if (!user) setLocation("/login");
                else setShowCreate(true);
              }}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Playlist
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 animate-fade-in-up">
            {playlists.map((playlist: PublicPlaylist) => (
              <StackedPlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        )}

        {/* Bottom ad */}
        <div className="mt-12 flex justify-center">
          <AdBanner file="medium-rect-300x250" />
        </div>
      </div>
    </Layout>
  );
}
