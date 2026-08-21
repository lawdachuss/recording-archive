const KEY = "vault_watched";
const TTL = 24 * 60 * 60 * 1000;

interface Entry {
  id: string;
  t: number;
  username?: string;
  filename?: string;
  thumbnail_url?: string | null;
}

export const WATCHED_CHANGED_EVENT = "vault-watched-changed";

export function addWatchedId(id: string, meta?: { username?: string; filename?: string; thumbnail_url?: string | null }): void {
  try {
    const raw = localStorage.getItem(KEY);
    const entries: Entry[] = raw ? JSON.parse(raw) : [];
    const filtered = entries.filter((e) => e.id !== id);
    filtered.push({ id, t: Date.now(), ...meta });
    const cutoff = Date.now() - TTL;
    localStorage.setItem(KEY, JSON.stringify(filtered.filter((e) => e.t > cutoff)));
    // Notify React components (useRecentlyWatched) that the watched set changed
    window.dispatchEvent(new CustomEvent(WATCHED_CHANGED_EVENT));
  } catch {}
}

export function getWatchedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const entries: Entry[] = JSON.parse(raw);
    const cutoff = Date.now() - TTL;
    return new Set(entries.filter((e) => e.t > cutoff).map((e) => e.id));
  } catch {
    return new Set();
  }
}

export function getWatchedEntries(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const entries: Entry[] = JSON.parse(raw);
    const cutoff = Date.now() - TTL;
    return entries.filter((e) => e.t > cutoff).sort((a, b) => b.t - a.t);
  } catch {
    return [];
  }
}

export function clearWatched(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(WATCHED_CHANGED_EVENT));
  } catch {}
}
