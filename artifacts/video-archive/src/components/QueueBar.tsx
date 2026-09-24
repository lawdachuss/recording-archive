import { Link, useLocation } from "wouter";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { proxyUrl } from "@/lib/proxy-url";
import { formatDuration } from "@/lib/formatters";
import { clearQueue, queueHref, type PlayQueue } from "@/lib/play-queue";
import { trackActivity } from "@/lib/rum";
import { ListVideo, ChevronLeft, ChevronRight, X, Clapperboard } from "lucide-react";

interface QueueBarProps {
  queue: PlayQueue;
  /** Position of the on-screen recording within the queue (-1 = not in queue). */
  index: number;
}

/**
 * Up-next strip rendered under the player while a playback queue is active.
 *
 * Cross-origin iframe servers can't report `ended`, so VideoDetail pairs this
 * bar with a countdown overlay (UpNextOverlay, scheduled from the recording's
 * metadata duration) that auto-advances near the estimated end. The bar stays
 * as the manual path: jump, replay, or bail out of the queue.
 */
export function QueueBar({ queue, index }: QueueBarProps) {
  const [, setLocation] = useLocation();
  const items = queue.items;
  const next = items[index + 1] ?? null;
  const hasPrev = index > 0;
  const nextThumb = next?.thumbnail_url ? proxyUrl(next.thumbnail_url) : null;

  const goTo = (target: number) => {
    const item = items[target];
    if (!item) return;
    trackActivity("queue_nav", { meta: { queue_title: queue.title, index: target } });
    window.scrollTo({ top: 0, behavior: "auto" });
    setLocation(queueHref(item));
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border border-primary/25 bg-primary/[0.03] rounded-lg px-3 py-2.5">
      {/* Queue identity + position */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-md border border-primary/30 flex items-center justify-center">
          <ListVideo className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="leading-tight min-w-0">
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Queue</p>
          <p className="text-xs font-semibold truncate max-w-[130px] sm:max-w-[220px]" title={queue.title}>
            {queue.title}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {Math.min(index + 1, items.length)}/{items.length}
        </span>
      </div>

      {/* Up next / end of queue */}
      {next ? (
        <button
          onClick={() => goTo(index + 1)}
          className="group flex items-center gap-2.5 flex-1 min-w-0 rounded-md border border-border/40 hover:border-primary/40 bg-background/40 px-2 py-1.5 transition-all text-left cursor-pointer"
          aria-label={`Play next: ${next.username}`}
        >
          {nextThumb ? (
            <OptimizedImage
              src={nextThumb}
              alt=""
              className="w-16 h-9 object-cover rounded-[3px]"
              containerClassName="w-16 h-9 rounded-[3px] shrink-0"
              fallback={
                <div className="w-16 h-9 bg-secondary rounded-[3px] flex items-center justify-center shrink-0">
                  <Clapperboard className="w-4 h-4 text-muted-foreground/20" />
                </div>
              }
            />
          ) : (
            <div className="w-16 h-9 bg-secondary rounded-[3px] flex items-center justify-center shrink-0">
              <Clapperboard className="w-4 h-4 text-muted-foreground/20" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Up next</p>
            <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
              {next.username}
              {next.room_title && next.room_title !== next.username ? ` · ${next.room_title}` : ""}
            </p>
          </div>
          {next.duration != null && next.duration > 0 && (
            <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0 hidden sm:block">
              {formatDuration(next.duration)}
            </span>
          )}
        </button>
      ) : (
        <div className="flex-1 min-w-0 text-xs text-muted-foreground/60">
          End of queue — pick another mix on the{" "}
          <Link href="/playlists" className="text-primary hover:underline">
            Playlists page
          </Link>
          .
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => goTo(index - 1)}
          disabled={!hasPrev}
          className="w-7 h-7 flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-all rounded-[3px] disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Previous in queue"
          title="Previous"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => goTo(index + 1)}
          disabled={!next}
          className="w-7 h-7 flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-all rounded-[3px] disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Next in queue"
          title="Next"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="w-px h-4 bg-border/40 mx-1" />
        <button
          onClick={() => {
            trackActivity("queue_clear", { meta: { queue_title: queue.title } });
            clearQueue();
          }}
          className="w-7 h-7 flex items-center justify-center border border-border/40 text-muted-foreground/50 hover:text-destructive hover:border-destructive/40 transition-all rounded-[3px]"
          aria-label="Clear queue"
          title="Clear queue"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
