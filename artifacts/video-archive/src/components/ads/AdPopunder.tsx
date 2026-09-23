import { useEffect } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { injectGlobalAd } from "@/lib/ad-creatives";

/**
 * AdPopunder — site-wide popunder driven by `ads/popunder.txt`.
 *
 * When ads are allowed (PremiumContext `showAds`), ONE random creative from
 * the file is injected once per page load; paste several codes separated by
 * a `---` line and each pageload fires a different network/offer (built-in
 * rotation). Ad-blocked users simply never fetch it, and an empty file means
 * no popunder at all.
 *
 * The env-driven Adsterra popunder (AdsterraGlobal) keeps working alongside
 * it — remove VITE_ADSTERRA_POPUNDER if you only want file-driven pops.
 */
export function AdPopunder() {
  const { showAds } = usePremium();

  useEffect(() => {
    if (showAds) injectGlobalAd("popunder");
  }, [showAds]);

  return null;
}
