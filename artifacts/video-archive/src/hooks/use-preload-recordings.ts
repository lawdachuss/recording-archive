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

// Only warm a tiny set of sprite sheets for immediate hover feedback. Native
// <img loading="lazy"> owns thumbnail delivery, and animated previews are
// requested on actual hover intent. Warming hundreds of all three media types
// at route entry wastes bandwidth, crowds the connection pool, and makes cold
// first paint slower for everyone else sharing the origin.
const MAX_WARM_ITEMS = 6;

export function usePreloadRecordings(recordings: RecordingLike[] | null | undefined): void {
  const warmable = (recordings ?? []).slice(0, MAX_WARM_ITEMS);
  const ids = warmable.map((r) => String(r.id)).join(",");
  useEffect(() => {
    if (warmable.length === 0) return;
    const limited = isConnectionConstrained() ? warmable.slice(0, 3) : warmable;
    preloadRecordingMedia(limited, {
      immediate: true,
      spriteLimit: 4,
      skipThumbnails: true,
      skipPreviews: true,
    });
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
}
