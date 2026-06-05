import type { SavedRecording } from "./bookmarks";

const COLLECTIONS_KEY = "vault-collections";

export interface Collection {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  items: SavedRecording[];
}

function readCollections(): Collection[] {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCollections(list: Collection[]) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(list));
}

export function getCollections(): Collection[] {
  return readCollections();
}

export function getCollection(id: string): Collection | undefined {
  return readCollections().find((c) => c.id === id);
}

export function createCollection(name: string, description?: string): Collection {
  const list = readCollections();
  const col: Collection = {
    id: crypto.randomUUID(),
    name: name.trim(),
    description: description?.trim(),
    created_at: new Date().toISOString(),
    items: [],
  };
  list.unshift(col);
  writeCollections(list);
  return col;
}

export function deleteCollection(id: string) {
  const list = readCollections().filter((c) => c.id !== id);
  writeCollections(list);
}

export function renameCollection(id: string, name: string) {
  const list = readCollections().map((c) =>
    c.id === id ? { ...c, name: name.trim() } : c,
  );
  writeCollections(list);
}

export function addToCollection(collectionId: string, rec: SavedRecording): boolean {
  const list = readCollections();
  const idx = list.findIndex((c) => c.id === collectionId);
  if (idx < 0) return false;
  const col = list[idx];
  if (col.items.some((r) => r.id === rec.id)) return false;
  col.items.unshift({ ...rec, saved_at: new Date().toISOString() });
  list[idx] = col;
  writeCollections(list);
  return true;
}

export function removeFromCollection(collectionId: string, recordingId: string) {
  const list = readCollections().map((c) =>
    c.id === collectionId
      ? { ...c, items: c.items.filter((r) => r.id !== recordingId) }
      : c,
  );
  writeCollections(list);
}

export function isInCollection(collectionId: string, recordingId: string): boolean {
  const col = getCollection(collectionId);
  return col ? col.items.some((r) => r.id === recordingId) : false;
}
