import { useEffect, useMemo, useRef, useState } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { injectAdMarkup } from "@/lib/ad-creatives";
import { useAds } from "@/contexts/AdsContext";

/**
 * AdGridCard — a STANDALONE ad card in video grids.
 *
 * Takes its OWN grid cell (same shape as VideoCard: aspect-video media box +
 * meta rows), so a real recording's thumbnail is NEVER covered — grids insert
 * it as a sibling next to a card picked by isAdCard(items, i):
 *
 *   <Fragment key={rec.id}>
 *     <div><VideoCard recording={rec} … /></div>
 *     {isAdCard(recordings, i) && <AdGridCard />}
 *   </Fragment>
 *
 * The creative comes from the slot configured in Admin → Ads → Placements
 * (default medium-rect-300x250) and is CONTAINED inside the black media box
 * (`.ad-thumb-host` object-fit: contain) so no banner content is ever cropped
 * away; it starts at a random creative and rotates every
 * `settings.rotationSeconds`, and carries a small "Ad" badge.
 *
 * Clicks on a link inside the creative open the AD in a new tab; clicks
 * anywhere else do nothing (this cell holds no video). Renders NOTHING — no
 * empty cell — when PremiumContext `showAds` is false, the in-feed zone is
 * switched off in Placements, or the configured slot has no creatives.
 */
const AD_FILE = "medium-rect-300x250";

export function AdGridCard() {
  const { showAds } = usePremium();
  const { creativesFor, settings } = useAds();

  const zoneOn = settings.placements.inCard !== false;
  const visible = showAds && zoneOn;
  const slot = settings.inCard.slot || AD_FILE;
  const rotateMs = settings.rotationSeconds * 1000;

  const creatives = useMemo(() => creativesFor(slot), [creativesFor, slot]);

  // Random start so several ad cards in view don't sync.
  const [index, setIndex] = useState(() =>
    creatives.length > 1 ? Math.floor(Math.random() * creatives.length) : 0
  );

  useEffect(() => {
    if (creatives.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % creatives.length),
      rotateMs
    );
    return () => window.clearInterval(id);
  }, [creatives.length, rotateMs]);

  const hostRef = useRef<HTMLDivElement>(null);

  // (Re)inject on mount and on every rotation; cleanup tears the ad down.
  useEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    if (!host || creatives.length === 0) return;
    return injectAdMarkup(host, creatives[index % creatives.length]);
  }, [visible, creatives, index]);

  if (!visible || creatives.length === 0) return null;

  return (
    <div className="group block animate-fade-in-up">
      <div
        className="relative aspect-video overflow-hidden bg-secondary rounded-sm"
        role="complementary"
        aria-label="Advertisement"
        onClick={(e) => {
          // Creative contains a link → open the AD in a new tab. No link
          // (bare <img> creative) → nothing: this cell isn't a video, so
          // there is no card navigation to fall through to.
          const link = (e.target as HTMLElement).closest("a");
          if (link instanceof HTMLAnchorElement && link.href) {
            e.stopPropagation();
            e.preventDefault();
            window.open(link.href, "_blank", "noopener,noreferrer");
          }
        }}
      >
        <div
          ref={hostRef}
          className="ad-thumb-host absolute inset-0 overflow-hidden"
        />
        {/* “Ad” marker — top-left, matches VideoCard's badge style */}
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded bg-black/50 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-white/80 ring-1 ring-white/10">
          Ad
        </span>
      </div>

      {/* Meta rows — same rhythm as VideoCard so grid rows stay aligned */}
      <div className="px-0.5 space-y-1">
        <div className="text-[13px] font-semibold text-muted-foreground/70 truncate">
          Sponsored
        </div>
        <div className="text-[11px] text-muted-foreground/50">Advertisement</div>
      </div>
    </div>
  );
}
