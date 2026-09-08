import { useEffect } from "react";
import { preloadRecordingSprites } from "@/lib/preload-sprite";
import { isConnectionConstrained } from "@/lib/connection";

type RecordingLike = {
  id: string | number;
  sprite_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
};

/**
 * Warm ALL hover media for a list of recordings as soon as the page has them:
 *   - thumbnails: the DOM <img> tags fetch these themselves (no double fetch)
 *   - sprites: queued immediate (jump ahead of idle warmers) at priority 2
 *   - animated .webp previews: queued at priority 1 alongside the sprites
 *
 * Everything runs in parallel in the background (16-way preload queue +
 * 6-way preview cap + 16-slot same-origin IDB pool) and lands in the IDB
 * blob cache, so hovering a card finds its media already stored — sprite or
 * preview paints instantly with zero network on hover.
 */
export function usePreloadRecordings(recordings: RecordingLike[] | null | undefined): void {
  const ids = (recordings ?? []).map((r) => String(r.id)).join(",");
  useEffect(() => {
    if (!recordings || recordings.length === 0) return;
    // On slow connections, only preload the first few visible recordings —
    // the rest are warmed when their cards enter the viewport.
    const limited = isConnectionConstrained() ? recordings.slice(0, 6) : recordings;
    preloadRecordingSprites(limited, { immediate: true });
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
}
