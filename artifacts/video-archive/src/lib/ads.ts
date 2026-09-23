/**
 * ads.ts — Adsterra ad configuration helpers.
 *
 * Placements resolve FILE-FIRST: codes pasted into the git-tracked
 * `ads/<name>.txt` files are baked into the bundle on every deploy, so they
 * work even when the Vercel dashboard's VITE_* values are empty (which is
 * the current state — env files never reach the build). The legacy VITE_*
 * env vars remain as fallbacks for anyone still configuring ads that way.
 * Rendering is gated client-side by PremiumContext `showAds` (age gate,
 * premium, excluded route). The Adsterra Publisher API token is never
 * shipped to the client — it lives server-side (ADSTERRA_API_KEY) behind
 * /api/ads/status.
 */

import {
  getDirectLink,
  getFileScriptSrc,
  hasAdCreative,
} from "@/lib/ad-creatives";

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

/**
 * Adsterra popunder loader — fires once per session when ads are enabled.
 * Returns undefined while `ads/popunder.txt` has codes: the file (tracked
 * in git, deployed with the site) wins over the env fallback, so the two
 * sources can never fire two popunders.
 */
export function adsterraPopunderScript(): string | undefined {
  if (hasAdCreative("popunder")) return undefined;
  const src = import.meta.env.VITE_ADSTERRA_POPUNDER as string | undefined;
  return sanitizeScriptUrl(src);
}

/**
 * Adsterra social bar loader — sticky bottom bar, loaded once per session.
 * `ads/socialbar.txt` (first `<script src>` pasted there) wins over
 * VITE_ADSTERRA_SOCIALBAR for the same file-first, deploy-safe reason.
 */
export function adsterraSocialBarScript(): string | undefined {
  const fromFile = getFileScriptSrc("socialbar");
  if (fromFile) return sanitizeScriptUrl(fromFile);
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

/**
 * Optional env-driven banner code used by AdBanner when its `ads/*.txt`
 * file is still empty (tier 2 — between file creatives and the JuicyAds
 * zone fallback). Two shapes are supported:
 *   - Adsterra atOptions pattern: VITE_ADSTERRA_BANNER_KEY +
 *     VITE_ADSTERRA_BANNER_INVOKE (URL or full <script src="…"> tag)
 *   - generic loader: VITE_AD_NETWORK_SCRIPT with optional VITE_AD_ZONE_ID /
 *     VITE_AD_CLASS passed as data-zone / class attributes
 * Returns undefined when the keys are missing or empty (the default state —
 * the slot then falls through to zones / its placeholder). The markup is
 * sized to the calling slot's width × height.
 */
export function adsterraBannerConfig(
  width: number,
  height: number
): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  const key = (env.VITE_ADSTERRA_BANNER_KEY ?? "").trim();
  const invoke = sanitizeScriptUrl(env.VITE_ADSTERRA_BANNER_INVOKE);
  if (key && invoke) {
    return (
      `<script>window.atOptions={key:${JSON.stringify(key)},` +
      `format:"iframe",height:${height},width:${width},params:{}};</script>` +
      `<script src="${invoke.replace(/"/g, "&quot;")}"></script>`
    );
  }
  const network = sanitizeScriptUrl(env.VITE_AD_NETWORK_SCRIPT);
  const zone = (env.VITE_AD_ZONE_ID ?? "").trim();
  if (network && zone) {
    const cls = (env.VITE_AD_CLASS ?? "").trim().replace(/"/g, "&quot;");
    const classAttr = cls ? ` class="${cls}"` : "";
    return (
      `<script src="${network.replace(/"/g, "&quot;")}" ` +
      `data-zone="${zone.replace(/"/g, "&quot;")}"${classAttr}></script>`
    );
  }
  return undefined;
}
