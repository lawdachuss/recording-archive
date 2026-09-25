/**
 * list-order.ts — pure helpers for user-ordered lists (collections, saved
 * lists). Kept framework-free so reorder rules are unit-testable without a
 * DOM, mirroring lib/play-queue.ts + lib/up-next.ts.
 */

/** Minimal shape the helpers need — ids plus anything else rides along. */
export interface PositionedItem {
  id: string;
}

/**
 * Sort key for playlist-style ordering: position first (0-based, dense from
 * migration 013), then added_at DESC (newest first among unranked), then id
 * as a deterministic tiebreak. Mutating client code keeps its own order and
 * only persists it — this comparator is for rendering fresh server data.
 */
export function byPositionThenNewest<T extends { position?: number | null; added_at?: string; id: string }>(
  a: T,
  b: T,
): number {
  const pa = a.position;
  const pb = b.position;
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  if (pa == null && pb != null) return 1;
  if (pa != null && pb == null) return -1;
  // Both unranked (or equal): newest first, then id for stability.
  const ta = a.added_at ? Date.parse(a.added_at) : 0;
  const tb = b.added_at ? Date.parse(b.added_at) : 0;
  if (tb !== ta) return tb - ta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Apply a drag-and-drop move to an ordered id list: remove `dragId`, then
 * insert it before `overId` (or at the end when `placeAfter`). Returns a new
 * array; the input is not mutated. No-op (same array content) when ids are
 * unknown or identical — callers can compare and skip the network write.
 */
export function moveItem(
  ids: string[],
  dragId: string,
  overId: string,
  placeAfter = false,
): string[] {
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || dragId === overId) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  let insertAt = next.indexOf(overId);
  if (placeAfter) insertAt += 1;
  next.splice(insertAt, 0, dragId);
  return next;
}
