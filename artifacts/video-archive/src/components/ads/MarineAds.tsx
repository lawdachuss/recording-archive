import { useEffect, useState } from "react";
import { usePremium } from "@/contexts/PremiumContext";

const MARINE_LOADER = "https://a.magsrv.com/ad-provider.js";

/** load the Marine Ads loader exactly once per page. */
let loaderLoaded = false;
let loaderFailed = false;
const marineFailureListeners = new Set<() => void>();

function notifyMarineFailure(): void {
  loaderFailed = true;
  marineFailureListeners.forEach((fn) => fn());
}

function ensureLoader(): void {
  if (loaderLoaded) {
    if (loaderFailed) notifyMarineFailure();
    return;
  }
  loaderLoaded = true;
  const el = document.createElement("script");
  el.type = "application/javascript";
  el.async = true;
  el.src = MARINE_LOADER;
  el.onerror = () => {
    notifyMarineFailure();
  };
  document.head.appendChild(el);
}

/**
 * Marine Ads / MagSRV (Easynetwork) — `<ins class="eas{zone}">` slot +
 * `AdProvider.push({"serve": {}})`.
 *
 * Rendered only when ads are allowed (PremiumContext `showAds`). The network
 * injects its own iframe so no height is reserved — a slot without a creative
 * simply takes no space.
 */
export function MarineAds({
  adzone,
  className,
}: {
  adzone: number;
  className?: string;
}) {
  const { showAds } = usePremium();
  const [blocked, setBlocked] = useState(loaderFailed);
  const classNameOut = "eas" + adzone;

  useEffect(() => {
    if (loaderFailed) {
      setBlocked(true);
      return;
    }
    const onFail = () => setBlocked(true);
    marineFailureListeners.add(onFail);
    return () => {
      marineFailureListeners.delete(onFail);
    };
  }, []);

  useEffect(() => {
    if (!showAds || blocked) return;
    const provider = window as unknown as {
      AdProvider?: Array<{ serve: Record<string, never> }>;
    };
    provider.AdProvider = provider.AdProvider ?? [];
    provider.AdProvider.push({ serve: {} });
    ensureLoader();
  }, [showAds, adzone, blocked]);

  if (!showAds || blocked) return null;

  return (
    <div
      role="complementary"
      aria-label="Advertisement"
      className={"flex items-center justify-center " + (className ?? "")}
      style={{ maxWidth: "100%", overflow: "hidden" }}
    >
      <ins className={classNameOut} data-zoneid={String(adzone)} />
    </div>
  );
}