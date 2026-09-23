/**
 * ads.ts — Adsterra ad configuration helpers.
 *
 * All three placements are config-driven via VITE_* build-time env vars so
 * codes can be swapped without touching component code. Rendering is still
 * gated client-side by PremiumContext `showAds` (age gate, grace, premium).
 * The Adsterra Publisher API token is never shipped to the client — it lives
 * server-side (ADSTERRA_API_KEY) behind /api/ads/status.
 */

import { getDirectLink } from "@/lib/ad-creatives";

function sanitizeScriptUrl(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  // If the user provided a full <script src="..."> tag, extract the URL
  const scriptMatch = trimmed.match(/src=["']([^"']+)["']/i);
  if (scriptMatch?.[1]) {
    return scriptMatch[1].trim();
  }
  // Remove wrapping quotes if any
  return trimmed.replace(/^["']|["']$/g, "").trim();
}

/** Adsterra popunder loader — fires once per session when ads are enabled. */
export function adsterraPopunderScript(): string | undefined {
  const src = import.meta.env.VITE_ADSTERRA_POPUNDER as string | undefined;
  return sanitizeScriptUrl(src);
}

/** Adsterra social bar loader — sticky bottom bar, loaded once per session. */
export function adsterraSocialBarScript(): string | undefined {
  const src = import.meta.env.VITE_ADSTERRA_SOCIALBAR as string | undefined;
  return sanitizeScriptUrl(src);
}

/** High-CPM smartlink for rewarded views / sponsor links.
 *  Resolution order: URLs pasted into `ads/direct-link.txt` (CrakRevenue
 *  direct links — random pick so several rotate) → VITE_ADSTERRA_SMARTLINK →
 *  built-in default. */
export function adsterraSmartlinkUrl(): string {
  const fromFiles = getDirectLink();
  if (fromFiles) return fromFiles;
  const configured = import.meta.env.VITE_ADSTERRA_SMARTLINK as string | undefined;
  const sanitized = sanitizeScriptUrl(configured);
  return (
    sanitized ||
    "https://www.profitableratecpmnetwork.com/y4pxebw3?key=887b8f78e3ae27d9f93a25ea64e7322a"
  );
}