import { useSyncExternalStore, useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userApi } from "@/lib/user-api";
import { trackActivity } from "@/lib/rum";
import { useAuth } from "@/contexts/AuthContext";
import { ListVideo, Plus, Check, Clock, X } from "lucide-react";

/**
 * AddToCollectionDialog — add any recording to a collection or Watch Later
 * from outside the video page (Browse cards, performer pages, mixes…).
 *
 * Module-level store: a single dialog instance mounted in App serves the
 * whole app; pages call openAddToCollection(recording) instead of each
 * owning their own picker UI (same decoupled-store pattern as
 * watched-storage / play-queue).
 */

export interface AddTarget {
  id: string;
  username: string;
  filename?: string | null;
  room_title?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  sprite_url?: string | null;
  resolution?: string | null;
  timestamp?: string | null;
}

interface DialogState {
  open: boolean;
  target: AddTarget | null;
}

let state: DialogState = { open: false, target: null };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function openAddToCollection(target: AddTarget): void {
  state = { open: true, target };
  emit();
}

export function closeAddToCollection(): void {
  state = { open: false, target: null };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Mount ONCE near the app root (App.tsx). Renders nothing while closed. */
export function AddToCollectionDialog() {
  const { open, target } = useSyncExternalStore(subscribe, () => state, () => state);
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [wlAdded, setWlAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setAddingTo(null);
      setAdded(null);
      setWlAdded(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAddToCollection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const { data: collections = [], isLoading } = useQuery({
    queryKey: ["user", "collections"],
    queryFn: () => userApi.getCollections(),
    enabled: open && !!user,
  });

  const addToCollection = useCallback(
    async (colId: string) => {
      if (!target) return;
      setAddingTo(colId);
      setError(null);
      try {
        await userApi.addCollectionItem(
          colId,
          target.id,
          JSON.stringify({ ...target, saved_at: new Date().toISOString() }),
        );
        trackActivity("collection_item_add", { meta: { collection_id: colId, recording_id: target.id } });
        setAdded(colId);
        queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
      } catch {
        setError("Could not add — try again.");
      } finally {
        setAddingTo(null);
      }
    },
    [target, queryClient],
  );

  const addToWatchLater = useCallback(async () => {
    if (!target) return;
    setAddingTo("__wl");
    setError(null);
    try {
      await userApi.addWatchLater(target.id, JSON.stringify({ ...target, saved_at: new Date().toISOString() }));
      trackActivity("watch_later", { meta: { recording_id: target.id, action: "add" } });
      setWlAdded(true);
      queryClient.invalidateQueries({ queryKey: ["user", "watch-later"] });
    } catch {
      setError("Could not add — try again.");
    } finally {
      setAddingTo(null);
    }
  }, [target, queryClient]);

  const createAndAdd = useCallback(async () => {
    if (!target || !newName.trim()) return;
    setAddingTo("__new");
    setError(null);
    try {
      const col = await userApi.createCollection(newName.trim());
      await userApi.addCollectionItem(
        col.id,
        target.id,
        JSON.stringify({ ...target, saved_at: new Date().toISOString() }),
      );
      trackActivity("collection_create", { meta: { collection_id: col.id, recording_id: target.id } });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
      setAdded(col.id);
      setNewName("");
    } catch {
      setError("Could not create — try again.");
    } finally {
      setAddingTo(null);
    }
  }, [target, newName, queryClient]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={closeAddToCollection}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add to collection"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Add to</p>
          <button
            onClick={closeAddToCollection}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2.5 border-b border-border/30">
          <p className="text-sm font-semibold truncate">{target?.username}</p>
          {target?.room_title && <p className="text-[11px] text-muted-foreground truncate">{target.room_title}</p>}
        </div>

        {!user ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground mb-4">
              {loading ? "Checking sign-in…" : "Sign in to save recordings to collections."}
            </p>
            <Link
              href="/login"
              onClick={closeAddToCollection}
              className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold border border-primary/40 text-primary hover:border-primary/70 rounded-md transition-colors"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1.5">
            <button
              onClick={addToWatchLater}
              disabled={addingTo !== null || wlAdded}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {wlAdded ? (
                <Check className="w-4 h-4 text-green-500 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-xs font-medium flex-1">Watch Later</span>
              {addingTo === "__wl" && <span className="text-[10px] text-muted-foreground">adding…</span>}
            </button>
            <div className="mx-4 my-1 border-t border-border/30" />
            {isLoading ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">Loading collections…</p>
            ) : (
              collections.map((col) => (
                <button
                  key={col.id}
                  onClick={() => addToCollection(col.id)}
                  disabled={addingTo !== null || added === col.id}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {added === col.id ? (
                    <Check className="w-4 h-4 text-green-500 shrink-0" />
                  ) : (
                    <ListVideo className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-xs font-medium flex-1 truncate">{col.name}</span>
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">{col.item_count ?? 0}</span>
                  {addingTo === col.id && <span className="text-[10px] text-muted-foreground">adding…</span>}
                </button>
              ))
            )}
            <div className="mx-4 my-1 border-t border-border/30" />
            <div className="flex items-center gap-1.5 px-4 py-2.5">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createAndAdd();
                }}
                maxLength={60}
                placeholder="New collection…"
                className="flex-1 h-8 bg-background border border-border/40 focus:border-primary/50 rounded-md px-2.5 text-xs outline-none"
              />
              <button
                onClick={createAndAdd}
                disabled={!newName.trim() || addingTo !== null}
                className="w-8 h-8 flex items-center justify-center border border-primary/30 text-primary rounded-md disabled:opacity-40 hover:border-primary/60 transition-colors"
                aria-label="Create and add"
                title="Create and add"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {error && <p className="px-4 pb-2 text-[11px] text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
