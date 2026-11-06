const STORAGE_KEY = "vault_recent_searches";
const MAX_RECENT_SEARCHES = 5;

type RecentSearchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getBrowserStorage(): RecentSearchStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Private browsing / browser policy can make localStorage unavailable.
    return null;
  }
}

/** Read a small, normalized history without allowing malformed storage to break Browse. */
export function readRecentSearches(
  storage: RecentSearchStorage | null = getBrowserStorage(),
): string[] {
  if (!storage) return [];
  try {
    const saved: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) return [];

    const unique: string[] = [];
    for (const value of saved) {
      if (typeof value !== "string") continue;
      const term = value.trim().replace(/\\s+/g, " ");
      if (!term || unique.some((item) => item.toLowerCase() === term.toLowerCase())) continue;
      unique.push(term);
      if (unique.length >= MAX_RECENT_SEARCHES) break;
    }
    return unique;
  } catch {
    return [];
  }
}

/** Store a normalized term, keeping only the five most recent unique searches. */
export function rememberRecentSearch(
  value: string,
  storage: RecentSearchStorage | null = getBrowserStorage(),
): string[] {
  const term = value.trim().replace(/\\s+/g, " ");
  const current = readRecentSearches(storage);
  if (!term) return current;

  const next = [
    term,
    ...current.filter((item) => item.toLowerCase() !== term.toLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);

  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Search still works when browser storage is unavailable or full.
  }
  return next;
}

/** Remove the locally stored search history. Does not affect current search filters. */
export function clearRecentSearches(
  storage: RecentSearchStorage | null = getBrowserStorage(),
): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory UI can still clear if browser storage is unavailable.
  }
}
