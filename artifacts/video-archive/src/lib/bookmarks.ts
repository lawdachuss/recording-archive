export interface SavedRecording {
  id: string;
  username: string;
  filename: string;
  room_title?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  resolution?: string | null;
  timestamp: string;
  saved_at: string;
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

// ─── Local bookmark functions ────────────────────────────

function getSavedList(): SavedRecording[] {
  try {
    const raw = localStorage.getItem("vault-bookmarks");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedList(items: SavedRecording[]) {
  localStorage.setItem("vault-bookmarks", JSON.stringify(items));
}

export function isBookmarked(id: string): boolean {
  return getSavedList().some((r) => r.id === id);
}

export function toggleBookmark(recording: SavedRecording): boolean {
  const list = getSavedList();
  const existing = list.findIndex((r) => r.id === recording.id);
  if (existing >= 0) {
    list.splice(existing, 1);
    saveSavedList(list);
    return false;
  }
  list.unshift(recording);
  saveSavedList(list);
  return true;
}

// ─── Local watch later functions ─────────────────────────

function getWatchLaterList(): SavedRecording[] {
  try {
    const raw = localStorage.getItem("vault-watch-later");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWatchLaterList(items: SavedRecording[]) {
  localStorage.setItem("vault-watch-later", JSON.stringify(items));
}

export function isInWatchLater(id: string): boolean {
  return getWatchLaterList().some((r) => r.id === id);
}

export function toggleWatchLater(recording: SavedRecording): boolean {
  const list = getWatchLaterList();
  const existing = list.findIndex((r) => r.id === recording.id);
  if (existing >= 0) {
    list.splice(existing, 1);
    saveWatchLaterList(list);
    return false;
  }
  list.unshift(recording);
  saveWatchLaterList(list);
  return true;
}

// ─── Local history functions ─────────────────────────────

function getHistoryList(): SavedRecording[] {
  try {
    const raw = localStorage.getItem("vault-history");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistoryList(items: SavedRecording[]) {
  localStorage.setItem("vault-history", JSON.stringify(items));
}

export function addToHistory(recording: SavedRecording) {
  const list = getHistoryList().filter((r) => r.id !== recording.id);
  list.unshift(recording);
  saveHistoryList(list.slice(0, 200));
}
