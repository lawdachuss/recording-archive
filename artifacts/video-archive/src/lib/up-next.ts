/**
 * up-next.ts — countdown scheduling for the iframe "Up Next" overlay.
 *
 * Cross-origin host players (VOE, Filemoon, …) expose nothing observable: no
 * `ended`, no currentTime, not even whether the user paused. The only clock we
 * have is the recording's own `duration` metadata, so the overlay is an
 * *estimate*: it appears UP_NEXT_LEAD_SECONDS before the metadata end and
 * auto-advances at the end. When the estimate runs long the overlay never
 * shows (the QueueBar still offers manual next); when it runs short the user
 * can cancel — every path degrades to the QueueBar, never to a broken player.
 *
 * Pure functions live here so the timing rules are unit-testable
 * (mirrors lib/preroll.ts + preroll.test.ts).
 */

/** Seconds before the estimated end that the overlay fades in. */
export const UP_NEXT_LEAD_SECONDS = 10;

/** Countdown tick — also the auto-advance granularity. */
export const UP_NEXT_TICK_MS = 500;

export interface UpNextTiming {
  /** Epoch ms at which the overlay becomes visible. */
  showAt: number;
  /** Epoch ms at which the countdown reaches zero and playback advances. */
  endsAt: number;
}

/**
 * Schedule a countdown for a video of `durationSeconds`.
 * Returns null when the duration is unknown/unusable — callers should then
 * simply never show the overlay.
 */
export function upNextTiming(
  durationSeconds: number,
  now: number = Date.now(),
): UpNextTiming | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const endsAt = now + durationSeconds * 1000;
  // Videos shorter than the lead window get an immediate showAt (clamped to
  // `now`) instead of a negative offset in the past.
  const showAt = Math.max(now, endsAt - UP_NEXT_LEAD_SECONDS * 1000);
  return { showAt, endsAt };
}

/** Whole seconds until `endsAt`, rounded up (0 or less → advance is due). */
export function secondsUntil(endsAt: number, now: number = Date.now()): number {
  return Math.ceil((endsAt - now) / 1000);
}
