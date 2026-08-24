import { useEffect } from "react";
import { preloadRecordingSprites } from "@/lib/preload-sprite";

type RecordingLike = {
  id: string | number;
  sprite_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
};

function isConnectionConstrained(): boolean {
  try {
    const conn = (navigator as any).connection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const slow = ["slow-2g", "2g", "3g"];
    return typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType);
  } catch {
    return false;
  }
}

/**
 * Warm hover media (sprites + reachable previews) for a list of recordings as
 * soon as the page has them. On slow connections, only preload the first few
 * visible recordings — the rest will be warmed when the user scrolls and
 * their cards enter the viewport.
 */
export function usePreloadRecordings(recordings: RecordingLike[] | null | undefined): void {
  const ids = (recordings ?? []).map((r) => String(r.id)).join(",");
  useEffect(() => {
    if (!recordings || recordings.length === 0) return;
    // On slow connections, only preload sprites for the first 6 recordings
    // (roughly the visible row) instead of all 40+ on the page.
    const limited = isConnectionConstrained() ? recordings.slice(0, 6) : recordings;
    // preloadRecordingSprites handles browser HTTP cache warming + IDB
    // persistence (via img.onload → cacheImage() in preload-sprite.ts).
    // No separate cacheImage loop needed — avoids duplicate network fetches.
    preloadRecordingSprites(limited);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
}
