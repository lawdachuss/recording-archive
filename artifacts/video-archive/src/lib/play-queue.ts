/**
 * play-queue.ts — session-scoped playback queue backing the Playlists page's
 * "Play all" flow.
 *
 * The queue is an ordered list of minimal recording snapshots stored in
 * sessionStorage: it survives in-app navigation and reloads within the tab,
 * but dies with the tab — a half-forgotten queue days later would be dead
 * weight.
 *
 * Storage and React are deliberately decoupled (same pattern as
 * watched-storage.ts): mutations write through and dispatch a window event,
 * and usePlayQueue re-reads on that event.
 */

export interface QueueItem {
  id: string;
  username: string;
  room_title?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  timestamp?: string;
}

export interface PlayQueue {
  title: string;
  items: QueueItem[];
  createdAt: number;
  /** When true, advancing past the last item wraps to the first (replay when there is only one). */
  loop?: boolean;
}

export const QUEUE_CHANGED_EVENT = "vault-queue-changed";

const STORAGE_KEY = "vault-play-queue";
/** Cap so a pathological mix can't blow up sessionStorage (items are tiny, but still). */
const MAX_ITEMS = 200;

/**
 * Build a queue snapshot from any recording-like object
 * (generated Recording, SavedRecording, cloud item, …).
 * Returns null when the object has no usable id.
 */
export function toQueueItem(r: {
  id?: string | null;
  username?: string | null;
  room_title?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  timestamp?: string | null;
}): QueueItem | null {
  if (!r || typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    username: typeof r.username === "string" ? r.username : "",
    room_title: r.room_title ?? null,
    thumbnail_url: r.thumbnail_url ?? null,
    duration: typeof r.duration === "number" ? r.duration : null,
    timestamp: typeof r.timestamp === "string" ? r.timestamp : undefined,
  };
}

/** sessionStorage can throw (privacy mode, sandboxed iframe) — never let that break the page. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keep the first occurrence of each id — duplicates would break position math. */
function dedupeById(items: QueueItem[]): QueueItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

function sanitizeQueue(raw: unknown): PlayQueue | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Partial<PlayQueue>;
  const items = Array.isArray(q.items)
    ? dedupeById(
        q.items
          .map((it) => toQueueItem(it ?? {}))
          .filter((it): it is QueueItem => it !== null),
      ).slice(0, MAX_ITEMS)
    : [];
  if (items.length === 0) return null;
  return {
    title: typeof q.title === "string" && q.title ? q.title : "Queue",
    items,
    createdAt: typeof q.createdAt === "number" ? q.createdAt : Date.now(),
    loop: q.loop === true,
  };
}

function notifyQueueChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT));
  } catch {
    /* listeners are best-effort */
  }
}

/** Read the persisted queue — null when absent, corrupt, or empty. */
export function getQueue(): PlayQueue | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeQueue(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Persist a new queue (replacing any existing one) and notify listeners.
 * Invalid items are dropped; when nothing usable remains the queue is cleared.
 * Returns the stored queue, or null when it was cleared.
 */
export function setQueue(title: string, rawItems: QueueItem[]): PlayQueue | null {
  const items = dedupeById(
    rawItems.filter((it) => it && typeof it.id === "string" && it.id),
  ).slice(0, MAX_ITEMS);
  if (items.length === 0) {
    clearQueue();
    return null;
  }
  // A freshly seeded queue always starts unlooped — the toggle is per-session
  // queue state, not something a new "Play all" should inherit.
  const queue: PlayQueue = { title, items, createdAt: Date.now(), loop: false };
  const s = storage();
  if (s) {
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch {
      /* quota/serialization failure — the in-memory return value still works this session */
    }
  }
  notifyQueueChanged();
  return queue;
}

/**
 * Toggle loop on the stored queue in place (no-op when no queue is active).
 * Returns the updated queue so callers can reflect the new state immediately.
 */
export function setQueueLoop(loop: boolean): PlayQueue | null {
  const current = getQueue();
  if (!current) return null;
  const updated: PlayQueue = { ...current, loop };
  const s = storage();
  if (s) {
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      /* quota failure — in-memory state is still correct for this session */
    }
  }
  notifyQueueChanged();
  return updated;
}

/** Remove the queue and notify listeners. */
export function clearQueue(): void {
  const s = storage();
  if (s) {
    try {
      s.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  notifyQueueChanged();
}

/** Route for a queue item — single source of truth for queue navigation. */
export function queueHref(item: QueueItem): string {
  return `/video/${item.id}`;
}

/** Side effects of a queue advance, injected so navigation is unit-testable. */
export interface QueueAdvanceDeps {
  /** Router navigation — wouter's `setLocation` in the app. */
  navigate: (href: string) => void;
  /** Reset scroll before the next recording mounts (window.scrollTo in the app). */
  scrollToTop: () => void;
  /** Analytics sink — receives the `queue_advance` event and its meta. */
  track: (event: string, meta: { queue_title: string; recording_id: string }) => void;
}

/**
 * The item that plays after `currentId` — the next in order, or the first
 * item again when loop is on (end-of-queue wrap; a one-item looped queue
 * returns the item itself, i.e. replay). Null when nothing should play next:
 * no queue, unknown id, or end of queue with loop off.
 */
export function nextQueueItem(
  queue: PlayQueue | null | undefined,
  currentId: string | null | undefined,
): QueueItem | null {
  if (!queue || !currentId) return null;
  const index = queue.items.findIndex((it) => it.id === currentId);
  if (index < 0) return null;
  const next = queue.items[index + 1];
  if (next) return next;
  return queue.loop && queue.items.length > 0 ? queue.items[0] : null;
}

/**
 * Fisher–Yates shuffle for queue items. When `keepFirstId` is given, that
 * item stays first (Spotify-style "start from the track you chose") and only
 * the rest are shuffled. Returns a new array; the input is not mutated.
 */
export function shuffleQueueItems(items: QueueItem[], keepFirstId?: string): QueueItem[] {
  const pool = items.filter((it) => it.id !== keepFirstId);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const first = keepFirstId ? items.find((it) => it.id === keepFirstId) : undefined;
  return first ? [first, ...pool] : pool;
}

/**
 * Advance past `currentId` in `queue`: report → scroll reset → navigate to the
 * next item's route (loop-aware — wraps to the first item when loop is on).
 * Returns false and fires no side effect when there is nothing to advance to
 * (no queue, unknown id, end of queue with loop off) — callers simply do
 * nothing, never a broken navigation.
 *
 * Extracted from VideoDetail's handleQueueAdvance (fed by the UpNextOverlay
 * countdown / "Play now") so the ordering and no-op rules are testable
 * without a DOM.
 */
export function advanceQueue(
  queue: PlayQueue | null | undefined,
  currentId: string | null | undefined,
  deps: QueueAdvanceDeps,
): boolean {
  if (!queue) return false;
  const next = nextQueueItem(queue, currentId);
  if (!next) return false;
  deps.track("queue_advance", { queue_title: queue.title, recording_id: next.id });
  deps.scrollToTop();
  deps.navigate(queueHref(next));
  return true;
}

/**
 * Subscribe to queue mutations (custom event + cross-tab storage event).
 * Returns an unsubscribe fn. No-op outside the browser.
 */
export function subscribeQueue(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener();
  };
  window.addEventListener(QUEUE_CHANGED_EVENT, onEvent);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(QUEUE_CHANGED_EVENT, onEvent);
    window.removeEventListener("storage", onStorage);
  };
}
