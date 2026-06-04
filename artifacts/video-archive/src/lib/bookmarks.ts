const BOOKMARKS_KEY = "vault-bookmarks";
const HISTORY_KEY = "vault-history";
const WATCH_LATER_KEY = "vault-watch-later";

export interface SavedRecording {
  id: string;
  username: string;
  filename: string;
  room_title?: string | null;
  thumbnail_url?: string | null;
  resolution?: string | null;
  timestamp: string;
  saved_at: string;
}

function readList(key: string): SavedRecording[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: SavedRecording[]) {
  localStorage.setItem(key, JSON.stringify(list));
}

export function getBookmarks(): SavedRecording[] {
  return readList(BOOKMARKS_KEY);
}

export function isBookmarked(id: string): boolean {
  return readList(BOOKMARKS_KEY).some((r) => r.id === id);
}

export function toggleBookmark(rec: SavedRecording): boolean {
  const list = readList(BOOKMARKS_KEY);
  const idx = list.findIndex((r) => r.id === rec.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    writeList(BOOKMARKS_KEY, list);
    return false;
  } else {
    list.unshift({ ...rec, saved_at: new Date().toISOString() });
    writeList(BOOKMARKS_KEY, list.slice(0, 500));
    return true;
  }
}

export function removeBookmark(id: string) {
  const list = readList(BOOKMARKS_KEY).filter((r) => r.id !== id);
  writeList(BOOKMARKS_KEY, list);
}

export function getHistory(): SavedRecording[] {
  return readList(HISTORY_KEY);
}

export function addToHistory(rec: SavedRecording) {
  const list = readList(HISTORY_KEY).filter((r) => r.id !== rec.id);
  list.unshift({ ...rec, saved_at: new Date().toISOString() });
  writeList(HISTORY_KEY, list.slice(0, 200));
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

export function getWatchLater(): SavedRecording[] {
  return readList(WATCH_LATER_KEY);
}

export function isInWatchLater(id: string): boolean {
  return readList(WATCH_LATER_KEY).some((r) => r.id === id);
}

export function toggleWatchLater(rec: SavedRecording): boolean {
  const list = readList(WATCH_LATER_KEY);
  const idx = list.findIndex((r) => r.id === rec.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    writeList(WATCH_LATER_KEY, list);
    return false;
  } else {
    list.unshift({ ...rec, saved_at: new Date().toISOString() });
    writeList(WATCH_LATER_KEY, list.slice(0, 500));
    return true;
  }
}

export function removeFromWatchLater(id: string) {
  const list = readList(WATCH_LATER_KEY).filter((r) => r.id !== id);
  writeList(WATCH_LATER_KEY, list);
}

export function clearWatchLater() {
  localStorage.removeItem(WATCH_LATER_KEY);
}

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem("vault-recent-searches");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string) {
  if (!query.trim()) return;
  const list = getRecentSearches().filter((q) => q !== query);
  list.unshift(query.trim());
  localStorage.setItem("vault-recent-searches", JSON.stringify(list.slice(0, 10)));
}

export function clearRecentSearches() {
  localStorage.removeItem("vault-recent-searches");
}
