import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { injectAdMarkup, parseAdDimensions } from "@/lib/ad-creatives";
import { useAds } from "@/contexts/AdsContext";
import { placementForFile, type AdPlacementId } from "@/lib/ad-slots";

/**
 * AdBanner — the site's single ad slot primitive.
 *
 * Content priority:
 *   1. Creatives from the ad system (Supabase `ad_creatives`, ads/*.txt as
 *      fallback) are injected (scripts execute) and ROTATED: a random
 *      creative first, then the next one every `settings.rotationSeconds`
 *      (default 20s) when the slot holds several codes.
 *   2. Otherwise a styled dashed placeholder reserved at the exact size —
 *      it matches the site UI, so layout is stable until real codes land.
 *
 * Placement zone (Admin → Ads → Placements): each banner belongs to a zone —
 * "strip" (leaderboards/billboards), "feed" (300×100 in-feed), or "box"
 * (everything else) — derived from `file` unless the `placement` prop says
 * otherwise. A zone switched off renders NOTHING, not even a placeholder.
 *
 * Nothing renders at all when PremiumContext says `showAds` is false:
 * under-age-gate, premium members, excluded routes (login/signup/premium/
 * admin), or a page switched off in Placements.
 *
 * `breakpoint` controls responsive visibility; dimensions default to the
 * `NNNxNNN` part of the file name (e.g. `leaderboard-728x90` → 728 × 90).
 * `fluid` stretches the box to the full container width — used for in-feed
 * rows that span a whole grid row (`col-span-full`).
 */

export type AdBreakpoint = "all" | "desktop" | "mobile" | "lg" | "md-lg";

const BREAKPOINT_CLASSES: Record<AdBreakpoint, string> = {
  all: "flex",
  desktop: "hidden md:flex",
  mobile: "md:hidden flex",
  lg: "hidden lg:flex",
  "md-lg": "hidden md:flex lg:hidden",
};

export interface AdBannerProps {
  /** `ads/<file>.txt` — extension optional; dimensions parsed from name. */
  file: string;
  /** Text inside the placeholder (defaults to "Advertisement"). */
  label?: string;
  /** Override the width parsed from the file name. */
  width?: number;
  /** Override the height parsed from the file name. */
  height?: number;
  /** Responsive visibility (default: visible at every size). */
  breakpoint?: AdBreakpoint;
  /** Stretch to the container width (in-feed rows, full-width dividers). */
  fluid?: boolean;
  /** Placement zone for admin toggles (default derived from `file`). */
  placement?: AdPlacementId;
  /** Override the rotation period (default: admin `settings.rotationSeconds`). */
  rotateMs?: number;
  /** Render the reserved placeholder when the slot is empty (default true). */
  placeholder?: boolean;
  /** Extra classes on the slot root (e.g. `col-span-full`, `mb-8`). */
  className?: string;
}

export function AdBanner({
  file,
  label,
  width: widthProp,
  height: heightProp,
  breakpoint = "all",
  fluid = false,
  placement: placementProp,
  rotateMs,
  placeholder = true,
  className,
}: AdBannerProps) {
  const { showAds } = usePremium();
  const { creativesFor, settings } = useAds();

  const zone = placementProp ?? placementForFile(file);
  const visible = showAds && settings.placements[zone] !== false;
  const rotate = rotateMs ?? settings.rotationSeconds * 1000;

  const dims = useMemo(() => parseAdDimensions(file), [file]);
  const width = widthProp ?? dims.width;
  const height = heightProp ?? dims.height;

  const creatives = useMemo(() => creativesFor(file), [creativesFor, file]);

  // Start at a random creative so two slots with the same file don't sync.
  const [index, setIndex] = useState(() =>
    creatives.length > 1 ? Math.floor(Math.random() * creatives.length) : 0
  );

  // Rotate creatives; skipped for single-creative slots (the common case)
  // so interval churn stays zero.
  useEffect(() => {
    if (creatives.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % creatives.length),
      rotate
    );
    return () => window.clearInterval(id);
  }, [creatives.length, rotate]);

  const hostRef = useRef<HTMLDivElement>(null);

  // (Re)inject the active creative whenever it rotates or ads toggle on.
  // The effect cleanup empties the host, so the outgoing ad is torn down.
  useEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    if (!host || creatives.length === 0) return;
    const active = creatives[index % creatives.length];
    return injectAdMarkup(host, active);
  }, [visible, creatives, index]);

  if (!visible) return null;

  const root =
    "w-full justify-center " +
    BREAKPOINT_CLASSES[breakpoint] +
    (className ? " " + className : "");

  if (creatives.length > 0) {
    const boxStyle: CSSProperties = fluid
      ? { width: "100%", minHeight: height }
      : { width: "100%", maxWidth: width, minHeight: height };
    return (
      <div className={root}>
        <div
          ref={hostRef}
          role="complementary"
          aria-label={`Advertisement ${width} by ${height}`}
          className="flex items-center justify-center overflow-hidden"
          style={boxStyle}
        />
      </div>
    );
  }

  if (!placeholder) return null;

  const boxStyle: CSSProperties = fluid
    ? { width: "100%", height }
    : { width: "100%", maxWidth: width, height };

  return (
    <div className={root}>
      <div
        role="complementary"
        aria-label={`Advertisement placeholder ${width} by ${height}`}
        className="relative flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border border-dashed border-border/40 bg-secondary/10 dark:bg-white/[0.03]"
        style={boxStyle}
      >
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-border/30 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Ad
        </span>
        <span className="px-3 text-center text-[11px] font-medium text-muted-foreground/50">
          {label ?? "Advertisement"}
        </span>
        <span className="text-[10px] font-mono tracking-wide text-muted-foreground/35">
          {width} × {height}
        </span>
      </div>
    </div>
  );
}
