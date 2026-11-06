import { useEffect } from "react";
import { preloadRecordingMedia } from "@/lib/preload-sprite";
import { isConnectionConstrained } from "@/lib/connection";

type RecordingLike = {
  id: string | number;
  sprite_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  preview_mirrors?: Record<string, string> | null;
  sprite_mirrors?: Record<string, string> | null;
  thumbnail_mirrors?: Record<string, string> | null;
};

// Warm a small first-screen window, not the entire catalogue. Thumbnails are
// the critical path for grid paint; sprites remain a smaller secondary warm.
const MAX_WARM_ITEMS = 10;

export function usePreloadRecordings(recordings: RecordingLike[] | null | undefined): void {
  const warmable = (recordings ?? []).slice(0, MAX_WARM_ITEMS);
  // Include media URLs as well as IDs so changed thumbnails are re-warmed
  // even when the recording identity itself remains the same.
  const warmKey = warmable
    .map((r) => [String(r.id), r.thumbnail_url ?? "", r.sprite_url ?? ""].join(":"))
    .join(",");
  useEffect(() => {
    if (warmable.length === 0) return;
    const limited = isConnectionConstrained() ? warmable.slice(0, 3) : warmable;
    preloadRecordingMedia(limited, {
      // Prioritize first-screen thumbnails so the first scroll doesn't wait
      // for lazy <img> requests to begin. Sprite warming follows thumbnails.
      immediate: true,
      priority: 3,
      spriteLimit: 3,
      skipThumbnails: false,
      skipPreviews: true,
    });
  }, [warmKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
