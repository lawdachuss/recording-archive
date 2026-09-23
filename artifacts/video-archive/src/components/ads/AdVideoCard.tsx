import { useEffect, useMemo, useRef, useState } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import {
  getAdCreatives,
  injectAdMarkup,
  parseAdDimensions,
} from "@/lib/ad-creatives";

/**
 * AdVideoCard — native ad that occupies ONE grid cell like a video card
 * (xHamster-style): a 16:9 media box plus a title strip that mirrors
 * VideoCard's meta block, so the ad blends into the recordings grid
 * instead of breaking the row with a full-width banner.
 *
 * Reads `ads/<file>.txt` (default `medium-rect-300x250`): the creative is
 * letterboxed to fit the cell (never cropped), starts at a RANDOM one and
 * rotates through the rest every 20s. Empty file → card-shaped dashed
 * placeholder at the same size. Renders nothing when PremiumContext
 * `showAds` is false (age gate, premium, excluded route).
 *
 * Usage inside a grid (it is a plain grid item, one column wide):
 *   {items.length > 8 && <AdVideoCard />}
 */
const ROTATE_MS = 20_000;

export interface AdVideoCardProps {
  /** `ads/<file>.txt` — extension optional. */
  file?: string;
  /** Extra classes on the card root (grid positioning, spacing…). */
  className?: string;
}

export function AdVideoCard({
  file = "medium-rect-300x250",
  className,
}: AdVideoCardProps) {
  const { showAds } = usePremium();
  const creatives = useMemo(() => getAdCreatives(file), [file]);
  const dims = useMemo(() => parseAdDimensions(file), [file]);

  // Random start so multiple ad cards in view don't sync.
  const [index, setIndex] = useState(() =>
    creatives.length > 1 ? Math.floor(Math.random() * creatives.length) : 0
  );

  useEffect(() => {
    if (creatives.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % creatives.length),
      ROTATE_MS
    );
    return () => window.clearInterval(id);
  }, [creatives.length]);

  const hostRef = useRef<HTMLDivElement>(null);

  // (Re)inject on mount and on every rotation; cleanup tears the ad down.
  useEffect(() => {
    if (!showAds) return;
    const host = hostRef.current;
    if (!host || creatives.length === 0) return;
    return injectAdMarkup(host, creatives[index % creatives.length]);
  }, [showAds, creatives, index]);

  if (!showAds) return null;
  const hasCreative = creatives.length > 0;

  return (
    <div className={"group flex flex-col gap-2 " + (className ?? "")}>
      {/* Media box — exact VideoCard shape (aspect-video, rounded-sm) */}
      <div
        className={
          "relative aspect-video overflow-hidden rounded-sm " +
          (hasCreative
            ? "bg-black/40 ring-1 ring-border/40"
            : "flex flex-col items-center justify-center gap-1 border border-dashed border-border/40 bg-secondary/10 dark:bg-white/[0.03]")
        }
      >
        {/* “Ad” marker — top-left, matches VideoCard's badge style */}
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded bg-black/50 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-white/80 ring-1 ring-white/10">
          Ad
        </span>

        {hasCreative ? (
          <div
            ref={hostRef}
            role="complementary"
            aria-label="Advertisement"
            className="ad-card-host absolute inset-0 flex items-center justify-center overflow-hidden"
          />
        ) : (
          <>
            <span className="px-3 text-center text-[11px] font-medium text-muted-foreground/50">
              Advertisement
            </span>
            <span className="text-[10px] font-mono tracking-wide text-muted-foreground/35">
              {dims.width} × {dims.height}
            </span>
          </>
        )}
      </div>

      {/* Title strip — mirrors VideoCard's meta block so rows stay uniform */}
      <div className="px-0.5 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-muted-foreground/70">
            Sponsored
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground/50">Advertisement</span>
          <span className="text-[10px] text-muted-foreground/40">Promoted</span>
        </div>
      </div>
    </div>
  );
}
