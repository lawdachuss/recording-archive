import { AdBanner, type AdBreakpoint } from "@/components/ads/AdBanner";

/**
 * AdSlot — legacy wrapper kept for backwards compatibility.
 *
 * Historically this rendered env-configured JuicyAds zones only
 * (`VITE_JUICYADS_<NAME>_ZONE`). It now delegates to AdBanner, which reads
 * `ads/<name>.txt` first (paste CrakRevenue codes there) and falls back to
 * the same env zones when the file is empty — placeholders included.
 *
 * New code should use <AdBanner file="…" /> or <AdLeaderboard /> directly.
 */
export interface AdSlotProps {
  /** Uppercase slot key: the env var suffix and the `ads/<name>.txt` file. */
  name: string;
  /** Human label shown inside the placeholder. */
  label: string;
  /** Fallback width used when the file name has no dimensions. */
  width: number;
  /** Fallback height used when the file name has no dimensions. */
  height: number;
  /** true → desktop-only (hidden below md); false → mobile-only (md+ hidden) */
  desktop?: boolean;
}

export function AdSlot({ name, label, width, height, desktop = true }: AdSlotProps) {
  const breakpoint: AdBreakpoint = desktop ? "desktop" : "mobile";
  return (
    <AdBanner
      file={name}
      label={label}
      width={width}
      height={height}
      breakpoint={breakpoint}
      zoneEnv={name}
    />
  );
}
