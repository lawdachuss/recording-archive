import { useEffect, useRef, useState } from "react";
import { Play, X, Clapperboard } from "lucide-react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { proxyUrl } from "@/lib/proxy-url";
import { formatDuration } from "@/lib/formatters";
import { upNextTiming, secondsUntil, UP_NEXT_TICK_MS } from "@/lib/up-next";
import { type QueueItem } from "@/lib/play-queue";
import { cn } from "@/lib/utils";

interface UpNextOverlayProps {
  /** The queued recording that plays when the countdown reaches zero. */
  next: QueueItem;
  /** Current recording length in seconds (`video.duration`) — the only clock available. */
  durationSeconds: number;
  /** Advance to `next` (navigates, scrolls to top, tracks). */
  onPlayNow: () => void;
}

/**
 * Countdown card shown over iframe-hosted players near the end of a queued
 * video. Cross-origin `ended` is unobservable, so the schedule comes from the
 * metadata duration (see lib/up-next.ts) — an estimate by nature.
 *
 * Controls: "Play now" advances immediately; the X cancels the countdown AND
 * the auto-advance entirely (the QueueBar below the player stays as the manual
 * path). Unknown duration → never renders.
 *
 * Positioned top-right so it never covers the host's playback controls along
 * the bottom edge, and sits above the site's own fullscreen button (z-20 vs
 * z-10) while visible.
 */
export function UpNextOverlay({ next, durationSeconds, onPlayNow }: UpNextOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [cancelled, setCancelled] = useState(false);

  // Keep the latest callback without restarting the countdown on re-renders.
  const playRef = useRef(onPlayNow);
  useEffect(() => {
    playRef.current = onPlayNow;
  }, [onPlayNow]);

  useEffect(() => {
    if (cancelled) return;
    const timing = upNextTiming(durationSeconds);
    if (!timing) return; // unknown duration → overlay never shows
    const iv = setInterval(() => {
      const now = Date.now();
      if (now >= timing.endsAt) {
        clearInterval(iv); // never double-fire before unmount
        setVisible(false);
        playRef.current();
        return;
      }
      if (now >= timing.showAt) {
        setVisible(true);
        setRemaining(secondsUntil(timing.endsAt, now));
      }
    }, UP_NEXT_TICK_MS);
    return () => clearInterval(iv);
  }, [cancelled, durationSeconds]);

  if (!visible || cancelled) return null;

  const thumb = next.thumbnail_url ? proxyUrl(next.thumbnail_url) : null;
  const subtitle = next.room_title && next.room_title !== next.username ? next.room_title : null;
  const imminent = remaining <= 3;

  return (
    <div
      className="absolute top-3 right-3 z-20 w-[240px] sm:w-64 max-w-[calc(100%-1.5rem)] animate-fade-in-up"
      aria-label="Up next"
    >
      <div className="rounded-lg border border-primary/40 bg-black/85 backdrop-blur-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-white/10">
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary">
            Up next
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-[11px] font-bold tabular-nums",
                imminent ? "text-primary animate-pulse" : "text-white/70",
              )}
            >
              {formatDuration(Math.max(remaining, 0))}
            </span>
            <button
              onClick={() => setCancelled(true)}
              aria-label="Cancel up next"
              title="Cancel up next"
              className="w-4 h-4 flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="flex gap-2.5 p-2.5">
          {thumb ? (
            <OptimizedImage
              src={thumb}
              alt=""
              className="w-28 h-16 object-cover rounded-[3px]"
              containerClassName="w-28 h-16 rounded-[3px] shrink-0"
              fallback={
                <div className="w-28 h-16 bg-secondary rounded-[3px] flex items-center justify-center shrink-0">
                  <Clapperboard className="w-5 h-5 text-white/20" />
                </div>
              }
            />
          ) : (
            <div className="w-28 h-16 bg-secondary rounded-[3px] flex items-center justify-center shrink-0">
              <Clapperboard className="w-5 h-5 text-white/20" />
            </div>
          )}
          <div className="min-w-0 flex-1 self-center">
            <p className="text-xs font-semibold text-white truncate">{next.username}</p>
            {subtitle && (
              <p className="text-[10px] text-white/50 truncate mt-0.5">{subtitle}</p>
            )}
            {next.duration != null && next.duration > 0 && (
              <p className="text-[10px] text-white/40 mt-1 tabular-nums">
                {formatDuration(next.duration)}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={() => playRef.current()}
          className="w-full flex items-center justify-center gap-1.5 h-8 text-xs font-semibold border-t border-white/10 text-primary hover:bg-primary/15 transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          Play now
        </button>
      </div>
    </div>
  );
}
