import { useEffect, useMemo, useRef } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { useAds } from "@/contexts/AdsContext";
import { injectGlobalAd, buildClickPopMarkup } from "@/lib/ad-creatives";

/**
 * AdPopunder — site-wide popunder, managed from Admin → Ads (Supabase
 * `ad_creatives`, slot "popunder") with ads/popunder.txt as the
 * build-time fallback. Candidates = the admin-managed creatives plus,
 * when the StripCash zone is on, a click-pop of the StripCash smartlink.
 *
 * Once ads are allowed (PremiumContext `showAds`) AND the ad source has
 * RESOLVED (Supabase fetched, or fell back to files), ONE random candidate
 * fires at most once per page load. Realtime admin edits apply instantly to
 * every page that hasn't fired yet; a page that already fired keeps its
 * popunder (re-firing would be obnoxious) — the new code fires on the next
 * pageload. Empty everywhere = no popunder at all.
 */
export function AdPopunder() {
  const { showAds } = usePremium();
  const { creativesFor, status, settings, stripcash } = useAds();
  const creatives = useMemo(() => creativesFor("popunder"), [creativesFor]);
  const firedRef = useRef(false);

  // StripCash smartlink as a click-pop candidate (its own zone switch).
  const stripcashPop = useMemo(() => {
    if (settings.placements.stripcash === false || !stripcash?.smartlink) return null;
    return buildClickPopMarkup(stripcash.smartlink);
  }, [stripcash, settings.placements.stripcash]);

  useEffect(() => {
    // Wait for the source to settle so a file fallback never pre-empts the
    // real (admin-managed) popunder that's about to arrive.
    if (!showAds || status === "pending") return;
    if (settings.placements.popunder === false) return;
    if (firedRef.current) return;
    const pool = stripcashPop ? [...creatives, stripcashPop] : creatives;
    if (pool.length === 0) return;
    firedRef.current = true;
    injectGlobalAd(
      "popunder",
      pool[Math.floor(Math.random() * pool.length)],
    );
  }, [showAds, status, creatives, stripcashPop, settings.placements.popunder]);

  return null;
}
