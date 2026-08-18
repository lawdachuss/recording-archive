import { useEffect } from "react";
import { preloadRecordingSprites } from "@/lib/preload-sprite";

type RecordingLike = {
  id: string | number;
  sprite_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
};

/**
 * Warm hover media (sprites + reachable previews) for a list of recordings as
 * soon as the page has them. Keyed on the recording ids so a re-render with
 * the same data doesn't re-schedule work. Thumbnails are deliberately NOT
 * preloaded here — the rendered <img> tags fetch those themselves, so
 * preloading would just double the requests and delay grid paint.
 */
export function usePreloadRecordings(recordings: RecordingLike[] | null | undefined): void {
  const ids = (recordings ?? []).map((r) => String(r.id)).join(",");
  useEffect(() => {
    if (!recordings || recordings.length === 0) return;
    preloadRecordingSprites(recordings);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
}
