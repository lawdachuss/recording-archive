/**
 * preroll.ts — picking the pre-roll video creative for a Video detail page.
 *
 * The admin pastes hosted video URLs (StripCash prerolls like
 * `https://video.whitetrafsa.com/production/prerolls/….mp4`) into the
 * `preroll` slot of Admin → Ads. Those rows are stored RAW (the server's
 * slotDims() returns null for this slot, so no auto-embed sniff rewrites
 * them) and the player feeds them straight to `<video src>`.
 *
 * One creative is picked per page visit, at play time:
 *   - enabled `preroll` rows first (Supabase `ad_creatives` is
 *     authoritative whenever it's reachable),
 *   - `ads/preroll.txt` bare-URL lines as the build-time fallback,
 *   - a random start so consecutive visits rotate through the pool.
 *
 * A pasted iframe embed (kind = "html") becomes a full-player overlay
 * instead of a `<video>` — both get the same skip chrome from
 * components/ads/PrerollPlayer.tsx, which NEVER blocks the main video:
 * error, a start that hangs, or the skip button all release immediately.
 */
import type { AdRow } from "../contexts/AdsContext";
import { getPrerollFileUrls } from "./ad-creatives";

/** Skip button appears after this many ms (industry-standard 5s). */
export const PREROLL_SKIP_AFTER_MS = 5_000;

/** A preroll that never starts (dead URL, stalled network) releases the player after this. */
export const PREROLL_START_TIMEOUT_MS = 10_000;

export type PrerollCreative =
  | { type: "video"; url: string }
  | { type: "html"; html: string };

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Pick one preroll creative from the live rows (or the file fallback when
 * `rows` is null). Returns null when there is nothing to play — the video
 * page then starts the main video directly, exactly as before.
 */
export function pickPreroll(rows: readonly AdRow[] | null): PrerollCreative | null {
  const pool: PrerollCreative[] = [];
  if (rows) {
    for (const row of rows) {
      if (row.slot !== "preroll" || !row.enabled) continue;
      const content = row.content.trim();
      if (row.kind === "url" && URL_RE.test(content)) {
        pool.push({ type: "video", url: content });
      } else if (row.kind === "html" && content) {
        pool.push({ type: "html", html: content });
      }
    }
  } else {
    for (const url of getPrerollFileUrls()) pool.push({ type: "video", url });
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
