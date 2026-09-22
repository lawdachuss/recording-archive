import { useEffect, useMemo, useState } from "react";
import { usePremium } from "@/contexts/PremiumContext";
import { JuicyAds } from "@/components/ads/JuicyAds";

/**
 * AdSlot — responsive JuicyAds slot with multi-zone rotation.
 *
 * Sourced from `VITE_JUICYADS_<NAME>_ZONE`, which may hold a single zone,
 * comma/space separated zones, and per-zone sizes, e.g.:
 *   VITE_JUICYADS_MEDIUM_RECT_ZONE="1126921:300x250,1126922:308x286"
 * Zones rotate every ROTATE_MS so multiple creatives share one position.
 * With no zones configured it renders a dashed placeholder at the target size
 * (`AD` badge) so the reserved layout stays visible while zones are set up.
 *
 * `desktop` toggles responsive visibility: false → small screens only
 * (`md:hidden`), true → desktop only (hidden below md) and centered.
 */
const ROTATE_MS = 15_000;

interface ZoneConfig {
  zone: number;
  width?: number;
  height?: number;
}

function parseZones(name: string): ZoneConfig[] {
  const raw = (import.meta.env as Record<string, string | undefined>)[
    `VITE_JUICYADS_${name}_ZONE`
  ];
  if (!raw) return [];
  const out: ZoneConfig[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    if (!part) continue;
    const m = /^(\d+)(?::(\d+)x(\d+))?$/i.exec(part);
    if (!m) continue;
    const zone = Number(m[1]);
    const width = m[2] ? Number(m[2]) : undefined;
    const height = m[3] ? Number(m[3]) : undefined;
    if (Number.isFinite(zone) && zone > 0) {
      out.push({ zone, width, height });
    }
  }
  return out;
}

export interface AdSlotProps {
  /** Uppercase slot key, used for the env var name. */
  name: string;
  /** Human label shown inside the placeholder. */
  label: string;
  /** Fallback width used when a zone has no explicit size. */
  width: number;
  /** Fallback height used when a zone has no explicit size. */
  height: number;
  /** true → desktop-only (hidden below md); false → mobile-only (hidden at md+) */
  desktop?: boolean;
}

export function AdSlot({
  name,
  label,
  width,
  height,
  desktop = true,
}: AdSlotProps) {
  const { showAds } = usePremium();
  const zones = useMemo(() => parseZones(name), [name]);
  const [index, setIndex] = useState(() =>
    zones.length > 1 ? Math.floor(Math.random() * zones.length) : 0
  );

  useEffect(() => {
    if (zones.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % zones.length),
      ROTATE_MS
    );
    return () => window.clearInterval(id);
  }, [zones.length]);

  if (!showAds) return null;

  const responsive =
    "flex items-center justify-center " + (desktop ? "hidden md:flex " : "md:hidden flex ");

  if (zones.length > 0) {
    const active = zones[Math.min(index, zones.length - 1)];
    return (
      <div className={responsive}>
        <JuicyAds
          adzone={active.zone}
          width={active.width ?? width}
          height={active.height ?? height}
        />
      </div>
    );
  }

  const showPlaceholder =
    import.meta.env.DEV &&
    import.meta.env.VITE_SHOW_AD_PLACEHOLDERS === "true";

  if (!showPlaceholder) {
    return null;
  }

  return (
    <div className={responsive}>
      <div
        role="complementary"
        aria-label={`Advertisement placeholder ${width}x${height}`}
        className="relative flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-border/40 bg-secondary/10 dark:bg-white/[0.03]"
        style={{ width: "100%", maxWidth: width, height }}
      >
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-border/30 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          AD
        </span>
        <span className="px-3 text-center text-[11px] font-mono tracking-wide text-muted-foreground/50">
          {label}
        </span>
      </div>
    </div>
  );
}