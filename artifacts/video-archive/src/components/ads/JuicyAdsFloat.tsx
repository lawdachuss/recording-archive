import { useEffect } from "react";
import { usePremium } from "@/contexts/PremiumContext";

const JFC_LOADER = "https://poweredby.jads.co/js/jfc.js";

/** JuicyAds float ad — loads exactly once per page when ads are allowed. */
let floatLoaded = false;

export function JuicyAdsFloat() {
  const { showAds } = usePremium();
  const adzone = Number(import.meta.env.VITE_JUICYADS_FLOAT_ZONE);

  useEffect(() => {
    if (!showAds || floatLoaded) return;
    if (!Number.isFinite(adzone) || adzone <= 0) return;
    floatLoaded = true;
    // jfc.js expects the zone on window before the loader script runs.
    (window as unknown as { juicy_adzone?: string }).juicy_adzone = String(adzone);
    const el = document.createElement("script");
    el.type = "text/javascript";
    el.charset = "utf-8";
    el.src = JFC_LOADER;
    el.onerror = () => {
      /* ad loader failure never breaks the page */
    };
    document.head.appendChild(el);
  }, [showAds, adzone]);

  return null;
}