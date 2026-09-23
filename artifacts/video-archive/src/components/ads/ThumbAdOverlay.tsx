import { useEffect, useMemo, useRef, useState } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { injectAdMarkup } from "@/lib/ad-creatives";
import { useAds } from "@/contexts/AdsContext";

/**
 * ThumbAdOverlay — the in-card ad LAYER.
 *
 * Sits on top of a real VideoCard's thumbnail — chosen RANDOMLY by the
 * grid (isAdCard() picks at most `settings.inCard.maxPerPage` ad cards per
 * page; see VideoCard's `showAd` prop) instead of taking an extra grid
 * cell, so the grid keeps exactly one card per video. The creative comes
 * from the slot configured in Admin → Ads → Placements (default
 * medium-rect-300x250) and is CONTAINED inside the thumbnail
 * (`.ad-thumb-host` object-fit: contain on a black host) so no banner
 * content is ever cropped away; it starts at a random creative and rotates
 * every `settings.rotationSeconds`, and carries a small "Ad" badge.
 *
 * Clicks on a link inside the creative open the AD in a new tab (and never
 * navigate to the video); clicks on a plain image creative fall through to
 * the card's normal video link. Renders nothing when PremiumContext
 * `showAds` is false, the in-card zone is switched off in Placements, or
 * the configured slot has no creatives — the thumbnail simply stays
 * visible.
 */
const AD_FILE = "medium-rect-300x250";

export function ThumbAdOverlay() {
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
    <div
      className="absolute inset-0 z-20 bg-black"
      role="complementary"
      aria-label="Advertisement"
      onClick={(e) => {
        // Creative contains a link → open the AD in a new tab and keep the
        // card's wouter Link from navigating to the video instead.
        const link = (e.target as HTMLElement).closest("a");
        if (link instanceof HTMLAnchorElement && link.href) {
          e.stopPropagation();
          e.preventDefault();
          window.open(link.href, "_blank", "noopener,noreferrer");
        }
        // No link (bare <img> creative) → let the click fall through to
        // the video card link as usual.
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
  );
}
