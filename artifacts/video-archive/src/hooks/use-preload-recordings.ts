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

// Warm the whole current page plus several pages of lookahead at page level:
// a 40-item grid page (Browse) plus the 5-ahead continuous prefetch is ~240
// recordings. Warming BEYOND that (a 500-item WatchLater / Bookmarks list)
// would enqueue hundreds of thumbnails + sprites into the shared preload queue
// at once, flooding the IDB cache and displacing the hot set before the user
// ever scrolls there. Cards beyond this cap are warmed exactly when they
// approach the viewport (useHoverPreview's capped viewport preload) and by the
// scroll-ahead continuous prefetch — the moment the bytes are actually useful.
const MAX_WARM_ITEMS = 240;

/**
 * Warm ALL hover media for a list of recordings as soon as the page has them:
 *   - thumbnails: background-warmed at priority 3 (below-fold cards get their
 *     only fetch here; the mounted <img> finds the bytes in HTTP cache/IDB)
 *   - sprites: queued immediate (jump ahead of idle warmers) at priority 2
 *   - animated .webp previews: queued at priority 1 alongside the sprites
 *
 * Everything runs in parallel in the background (16-way preload queue +
 * 6-way preview cap + 16-slot same-origin IDB pool) and lands in the IDB
 * blob cache, so hovering a card finds its media already stored — sprite or
 * preview paints instantly with zero network on hover. Video previews are
 * deliberately NOT prefetched here (multi-MB); they stream on demand and
 * persist to IDB on first hover.
 *
 * The warming is bounded to the first `MAX_WARM_ITEMS` recordings — cards
 * deeper in a very long list are warmed on viewport entry / scroll-ahead
 * instead, keeping huge personal lists from flooding the cache at once.
 */
export function usePreloadRecordings(recordings: RecordingLike[] | null | undefined): void {
  const ids = (recordings ?? []).map((r) => String(r.id)).join(",");
  useEffect(() => {
    if (!recordings || recordings.length === 0) return;
    // On slow connections, only preload the first few visible recordings —
    // the rest are warmed when their cards enter the viewport.
    const limited = isConnectionConstrained()
      ? recordings.slice(0, 6)
      : recordings.slice(0, MAX_WARM_ITEMS);
    preloadRecordingMedia(limited, { immediate: true });
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
}
