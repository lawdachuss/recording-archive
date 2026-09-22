import { useEffect, useRef, useState } from "react";
import { usePremium } from "@/contexts/PremiumContext";

const JADS_LOADER = "https://poweredby.jads.co/js/jads.js";

/** load the JuicyAds global loader exactly once per page. */
let loaderLoaded = false;
let loaderFailed = false;
const failureListeners = new Set<() => void>();

function notifyFailure(): void {
  loaderFailed = true;
  failureListeners.forEach((fn) => fn());
}

function ensureLoader(): void {
  if (loaderLoaded) {
    if (loaderFailed) notifyFailure();
    return;
  }
  loaderLoaded = true;
  const el = document.createElement("script");
  el.type = "text/javascript";
  el.async = true;
  el.dataset.cfasync = "false";
  el.src = JADS_LOADER;
  el.onerror = () => {
    notifyFailure();
  };
  document.head.appendChild(el);
}

/**
 * JuicyAds v3 — `<ins>` slot + `adsbyjuicy.push({adzone})`.
 *
 * Rendered only when ads are allowed (PremiumContext `showAds`). The ad
 * height is reserved up front so the layout doesn't shift when the creative
 * loads. If an ad blocker blocks the script, the container automatically collapses.
 */
export function JuicyAds({
  adzone,
  width = 300,
  height = 50,
  className,
}: {
  adzone: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  const { showAds } = usePremium();
  const [blocked, setBlocked] = useState(loaderFailed);
  const id = String(adzone);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaderFailed) {
      setBlocked(true);
      return;
    }
    const onFail = () => setBlocked(true);
    failureListeners.add(onFail);
    return () => {
      failureListeners.delete(onFail);
    };
  }, []);

  useEffect(() => {
    if (!showAds || blocked) return;
    // The `ins` must exist in the DOM before the push registers it.
    const juicy = window as unknown as {
      adsbyjuicy?: Array<{ adzone: number }>;
    };
    juicy.adsbyjuicy = juicy.adsbyjuicy ?? [];
    for (let i = juicy.adsbyjuicy.length - 1; i >= 0; i--) {
      if (juicy.adsbyjuicy[i]?.adzone === adzone) juicy.adsbyjuicy.splice(i, 1);
    }
    ensureLoader();
    juicy.adsbyjuicy.push({ adzone });
  }, [showAds, adzone, blocked]);

  if (!showAds || blocked) return null;

  return (
    <div
      ref={ref}
      role="complementary"
      aria-label="Advertisement"
      className={"flex items-center justify-center overflow-hidden " + (className ?? "")}
      style={{ minHeight: height, width: "100%", maxWidth: width }}
    >
      <ins id={id} data-width={width} data-height={height} />
    </div>
  );
}