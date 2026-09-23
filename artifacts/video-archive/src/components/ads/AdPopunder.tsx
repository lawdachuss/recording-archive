import { useEffect, useMemo, useRef } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { useAds } from "@/contexts/AdsContext";
import { injectGlobalAd } from "@/lib/ad-creatives";

/**
 * AdPopunder — site-wide popunder, managed from Admin → Ads (Supabase
 * `ad_creatives`, slot "popunder") with ads/popunder.txt as the
 * build-time fallback.
 *
 * Once ads are allowed (PremiumContext `showAds`) AND the ad source has
 * RESOLVED (Supabase fetched, or fell back to files), ONE random creative
 * fires at most once per page load. Realtime admin edits apply instantly to
 * every page that hasn't fired yet; a page that already fired keeps its
 * popunder (re-firing would be obnoxious) — the new code fires on the next
 * pageload. Empty everywhere = no popunder at all.
 */
export function AdPopunder() {
  const { showAds } = usePremium();
  const { creativesFor, status, settings } = useAds();
  const creatives = useMemo(() => creativesFor("popunder"), [creativesFor]);
  const firedRef = useRef(false);

  useEffect(() => {
    // Wait for the source to settle so a file fallback never pre-empts the
    // real (admin-managed) popunder that's about to arrive.
    if (!showAds || status === "pending") return;
    if (settings.placements.popunder === false) return;
    if (firedRef.current || creatives.length === 0) return;
    firedRef.current = true;
    injectGlobalAd(
      "popunder",
      creatives[Math.floor(Math.random() * creatives.length)],
    );
  }, [showAds, status, creatives, settings.placements.popunder]);

  return null;
}
