import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import {
  getCollections,
  createCollection,
  deleteCollection,
  type Collection,
} from "@/lib/collections";
import {
  FolderOpen, Plus, Trash2, Film, ListVideo, ChevronRight,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";

export default function Collections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    setCollections(getCollections());
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const col = createCollection(newName.trim(), newDesc.trim() || undefined);
    setCollections((prev) => [col, ...prev]);
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
  };

  const handleDelete = (id: string) => {
    deleteCollection(id);
    setCollections((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        {/* Header */}
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
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shrink-0 rounded-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Collection
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 p-5 border border-primary/30 bg-primary/5 rounded-sm space-y-3"
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
                className="w-full h-9 bg-background border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={200}
                className="w-full h-9 bg-background border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="h-8 px-4 text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors rounded-sm"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }}
                className="h-8 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground transition-colors rounded-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {collections.length === 0 ? (
          <div className="py-24 text-center">
            <FolderOpen className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm font-medium text-muted-foreground mb-1">No collections yet</p>
            <p className="text-xs text-muted-foreground/60 mb-6">
              Create a collection and add recordings to it from the video page.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors rounded-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              New Collection
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {collections.map((col) => (
              <div
                key={col.id}
                className="flex items-center gap-4 border border-border/40 hover:border-primary/30 rounded-sm transition-all group"
              >
                {/* Thumbnail strip */}
                <div className="w-20 h-14 shrink-0 bg-secondary rounded-l-sm overflow-hidden flex items-center justify-center">
                  {col.items[0]?.thumbnail_url ? (
                    <img
                      src={col.items[0].thumbnail_url}
                      alt={col.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Film className="w-5 h-5 text-muted-foreground/20" />
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
                    <span>{col.items.length} {col.items.length === 1 ? "video" : "videos"}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(col.created_at)}</span>
                  </div>
                </Link>

                <div className="flex items-center gap-1 pr-3 shrink-0">
                  <Link href={`/collections/${col.id}`}>
                    <span className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground transition-colors rounded">
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </Link>
                  <button
                    onClick={() => handleDelete(col.id)}
                    className="flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-destructive transition-colors rounded"
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
