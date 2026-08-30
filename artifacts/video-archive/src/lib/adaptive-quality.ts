/**
 * adaptive-quality.ts — automatic, measurement-based bandwidth adaptation.
 *
 * The Network Information API (navigator.connection) is great but unavailable or
 * inaccurate on many browsers (notably Safari) and can't tell us how fast media
 * actually loads on THIS network right now. So we measure real thumbnail load
 * times and auto-tune the requested image width + whether to preload:
 *
 *   - median load >= 2.0s  -> 400px  (slow: tiny images, skip preloads)
 *   - median load >= 0.9s  -> 800px  (medium: skip preloads)
 *   - otherwise            -> 1200px (fast)
 *
 * Data Saver forces 400px. A window event lets mounted images re-resolve when
 * the tier changes, so adaptation is live with zero user action.
 */

import { isDataSaver } from "./data-saver";
import { getConnectionQuality } from "./connection";

export type Tier = 400 | 800 | 1200;
export const ADAPTIVE_TIER_EVENT = "adaptive-tier-change";

const samples: number[] = [];
const MAX_SAMPLES = 15;
let tier: Tier = 1200;

function median(): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function adjust() {
  if (samples.length < 5) return;
  const m = median();
  let next: Tier;
  if (m >= 2000) next = 400;
  else if (m >= 900) next = 800;
  else next = 1200;
  if (next !== tier) {
    tier = next;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(ADAPTIVE_TIER_EVENT));
    }
  }
}

/** Call from an <img> onLoad with the measured load duration (ms). */
export function recordImageLoad(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.shift();
  adjust();
}

export function getAdaptiveTier(): Tier {
  return tier;
}

/** Adaptive request width (px) for thumbnails. */
export function getAdaptiveImageWidth(): number {
  if (isDataSaver()) return 400;
  const net = getConnectionQuality();
  if (net === "slow") return Math.min(tier, 400) as Tier;
  if (net === "medium") return Math.min(tier, 800) as Tier;
  return tier;
}
