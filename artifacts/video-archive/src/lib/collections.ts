import type { SavedRecording } from "./bookmarks";

export interface Collection {
  id: string;
  name: string;
  description?: string;
  items: SavedRecording[];
  createdAt: string;
}

const STORAGE_KEY = "vault-collections";

export function getCollections(): Collection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCollections(collections: Collection[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
}

export function createCollection(name: string, description?: string): Collection {
  const collections = getCollections();
  const newCol: Collection = {
    id: crypto.randomUUID(),
    name,
    description,
    items: [],
    createdAt: new Date().toISOString(),
  };
  collections.unshift(newCol);
  saveCollections(collections);
  return newCol;
}

export function addToCollection(collectionId: string, recording: SavedRecording) {
  const collections = getCollections();
  const updated = collections.map((col) => {
    if (col.id !== collectionId) return col;
    if (col.items.some((item) => item.id === recording.id)) return col;
    return { ...col, items: [...col.items, recording] };
  });
  saveCollections(updated);
}

export function removeFromCollection(collectionId: string, recordingId: string) {
  const collections = getCollections();
  const updated = collections.map((col) => {
    if (col.id !== collectionId) return col;
    return { ...col, items: col.items.filter((item) => item.id !== recordingId) };
  });
  saveCollections(updated);
}

export function deleteCollection(id: string) {
  const collections = getCollections().filter((col) => col.id !== id);
  saveCollections(collections);
}

export function updateCollectionName(id: string, name: string) {
  const collections = getCollections().map((col) =>
    col.id === id ? { ...col, name } : col,
  );
  saveCollections(collections);
}
