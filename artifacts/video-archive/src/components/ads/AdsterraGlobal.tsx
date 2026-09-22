import { useEffect } from "react";
import { adsterraPopunderScript, adsterraSocialBarScript } from "@/lib/ads";
import { usePremium } from "@/contexts/PremiumContext";

/**
 * AdsterraGlobal — site-wide Adsterra placements (popunder + social bar).
 * Both load exactly once per session and only when ads are allowed
 * (PremiumContext `showAds`: age gate passed, grace elapsed, not premium,
 * not on an excluded page). Ad-blocked users simply never fetch them.
 */
const loaded = new Set<string>();

function injectOnce(src: string): void {
  if (loaded.has(src)) return;
  loaded.add(src);
  const el = document.createElement("script");
  el.async = true;
  el.src = src;
  el.dataset.cfasync = "false";
  el.onerror = () => {
    /* ad loader failure never breaks the page */
  };
  document.head.appendChild(el);
}

export function AdsterraGlobal() {
  const { showAds } = usePremium();

  useEffect(() => {
    if (!showAds) return;
    const popunder = adsterraPopunderScript();
    const socialBar = adsterraSocialBarScript();
    if (popunder) injectOnce(popunder);
    if (socialBar) injectOnce(socialBar);
  }, [showAds]);

  return null;
}