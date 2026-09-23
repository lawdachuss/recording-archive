import { usePremium } from "@/contexts/PremiumContext";
import { AdBanner } from "@/components/ads/AdBanner";

/**
 * AdLeaderboard — one responsive banner placement across three tiers:
 *   lg+   → `lg` file   (default leaderboard-728x90)
 *   md–lg → `md` file   (default banner-468x60)
 *   < md  → `mobile` file (default rect-300x100)
 *
 * Each tier is an independent slot reading its own `ads/<file>.txt`, so you
 * can paste different creatives per breakpoint (and the same file in two
 * tiers stays consistent). Renders NOTHING (no wrapper, no margins) when
 * ads are not shown, so pages can drop it anywhere without guarding.
 *
 * Example — site-wide top strip:
 *   <AdLeaderboard lg="billboard-970x250" md="leaderboard-728x90"
 *                  mobile="mobile-banner-320x50" className="mb-8" />
 */
interface AdLeaderboardProps {
  lg?: string;
  md?: string;
  mobile?: string;
  /** Text shown inside empty placeholders. */
  label?: string;
  /** Extra classes on the wrapper (spacing, centering, grid spans…). */
  className?: string;
}

export function AdLeaderboard({
  lg = "leaderboard-728x90",
  md = "banner-468x60",
  mobile = "rect-300x100",
  label,
  className,
}: AdLeaderboardProps) {
  const { showAds } = usePremium();
  if (!showAds) return null;

  return (
    <div className={"w-full flex justify-center " + (className ?? "")}>
      {/* Always zone “strip” (not the file-derived default): even the mobile
          rect tier here is a strip, and strip is what Placements toggles. */}
      <AdBanner file={lg} breakpoint="lg" label={label} placement="strip" />
      <AdBanner file={md} breakpoint="md-lg" label={label} placement="strip" />
      <AdBanner file={mobile} breakpoint="mobile" label={label} placement="strip" />
    </div>
  );
}
