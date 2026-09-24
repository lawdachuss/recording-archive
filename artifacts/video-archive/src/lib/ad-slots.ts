/**
 * Shared ad-slot / placement / page registry — the single source of truth
 * the runtime components, the admin panel and the API server all agree on.
 *
 * Keep the id lists in sync with the server-side validation sets in
 * artifacts/api-server/src/routes/admin-ads.ts (and ads/*.txt files).
 */

import { PINNED_IN_CARD_LIMIT } from "./ad-creatives";

export interface AdSlotDef {
  /** Slot id — matches the ads/<file>.txt name and the DB `slot` column. */
  file: string;
  /** Human label for the admin panel. */
  label: string;
  /** Display size ("—" for full-slot placements). */
  size: string;
  /** Short hint shown above the add-form. */
  note: string;
  /** True when no page component mounts this slot — creatives here never display (the admin shows a warning). */
  spare?: boolean;
}

export const AD_SLOTS: AdSlotDef[] = [
  { file: "billboard-970x250", label: "Billboard", size: "970×250", note: "Site-wide top strip (large screens)." },
  { file: "super-leaderboard-970x90", label: "Super Leaderboard", size: "970×90", note: "Spare wide slot (top strip alt).", spare: true },
  { file: "leaderboard-728x90", label: "Leaderboard", size: "728×90", note: "Footer, Browse top, VideoDetail, dividers." },
  { file: "banner-468x60", label: "Banner", size: "468×60", note: "Top strip + footer (medium screens)." },
  { file: "mobile-banner-320x50", label: "Mobile Banner", size: "320×50", note: "Site-wide top strip (phones)." },
  { file: "rect-300x100", label: "Rectangle (in-feed)", size: "300×100", note: "In-feed rows — Home, Browse, grids, above comments." },
  { file: "medium-rect-300x250", label: "Medium Rectangle", size: "300×250", note: "Sidebars, footer (phones), narrow pages, and the default grid ad card source." },
  { file: "large-rect-336x280", label: "Large Rectangle", size: "336×280", note: "Spare rectangle slot.", spare: true },
  { file: "half-page-300x600", label: "Half Page", size: "300×600", note: "VideoDetail sidebar (desktop)." },
  { file: "skyscraper-160x600", label: "Skyscraper", size: "160×600", note: "Spare sidebar skyscraper slot.", spare: true },
  { file: "square-250x250", label: "Square", size: "250×250", note: "Spare square slot.", spare: true },
  { file: "popunder", label: "Popunder", size: "—", note: "HTML/JS popunder code — one random creative fires once per page load." },
  { file: "direct-link", label: "Direct Links / Smartlinks", size: "—", note: "One URL per row — used by the Premium page's reward CTA." },
  { file: "preroll", label: "Pre-roll video", size: "—", note: "Plays before the video on Video detail — paste hosted .mp4 links (StripCash prerolls), one per line." },
];

/** Zones ads render in — each can be switched off from Admin → Ads → Placements. */
export type AdPlacementId =
  | "strip"
  | "feed"
  | "box"
  | "inCard"
  | "popunder"
  | "rewardCta"
  | "stripcash"
  | "preroll";

export interface AdPlacementDef {
  id: AdPlacementId;
  label: string;
  note: string;
}

export const AD_PLACEMENTS: AdPlacementDef[] = [
  { id: "strip", label: "Top strips & dividers", note: "Leaderboard/billboard/banner tiers — headers, footers, section dividers." },
  { id: "feed", label: "In-feed rectangles", note: "300×100 banners inside video grids (Home, Browse, Charts, comments…)." },
  { id: "box", label: "Sidebars & boxes", note: "Medium/half-page/skyscraper boxes — VideoDetail sidebar, footers, narrow pages." },
  { id: "inCard", label: "In-feed grid ad cards", note: "Standalone ad cards inserted into video grids — never covering a recording (count/slot set below)." },
  { id: "popunder", label: "Popunder", note: "One popunder fires per page load." },
  { id: "rewardCta", label: "Premium reward CTA link", note: "The direct link opened by the reward claim button on the Premium page." },
  { id: "stripcash", label: "StripCash smartlink (Stripchat)", note: "API-key smartlink — feeds the reward CTA link pool, and opens as the popunder ONLY when the Popunder slot is empty (it never displaces a configured popunder). StripCash banner codes go in slots as usual." },
  { id: "preroll", label: "Pre-roll video", note: "Plays before the video on Video detail pages — one random creative per visit, skip after 5s." },
];

/** Pages with an individual ad on/off switch. */
export interface AdPageDef {
  id: string;
  label: string;
  /** Paths belonging to this page id (exact match, or prefix + "/"). */
  match: string[];
}

export const AD_PAGES: AdPageDef[] = [
  { id: "home", label: "Home", match: ["/"] },
  { id: "browse", label: "Browse", match: ["/browse"] },
  { id: "video", label: "Video detail", match: ["/video"] },
  { id: "performers", label: "Performers", match: ["/performers"] },
  { id: "charts", label: "Charts", match: ["/charts"] },
  { id: "tags", label: "Tags", match: ["/tags"] },
  { id: "collections", label: "Collections", match: ["/collections"] },
  { id: "bookmarks", label: "Bookmarks", match: ["/bookmarks"] },
  { id: "history", label: "History", match: ["/history"] },
  { id: "watch-later", label: "Watch later", match: ["/watch-later"] },
  { id: "analytics", label: "Analytics", match: ["/analytics"] },
  { id: "following", label: "Following", match: ["/following"] },
  { id: "notifications", label: "Notifications", match: ["/notifications"] },
  { id: "my-requests", label: "My requests", match: ["/my-requests"] },
  { id: "request", label: "Request form", match: ["/request"] },
  { id: "profile", label: "Profile", match: ["/profile", "/user"] },
  { id: "settings", label: "Settings", match: ["/settings"] },
];

/** Map a route to its ad-page id (unknown routes fall back to the first path segment — a missing key reads as ON). */
export function adPageId(pathname: string): string {
  let path = pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") return "home";
  for (const page of AD_PAGES) {
    if (page.match.some((m) => path === m || path.startsWith(m + "/"))) return page.id;
  }
  return path.replace(/^\//, "").split("/")[0] || "home";
}

const STRIP_FILES = new Set([
  "billboard-970x250",
  "super-leaderboard-970x90",
  "leaderboard-728x90",
  "banner-468x60",
  "mobile-banner-320x50",
]);

/** Default placement zone for an AdBanner, derived from its file name (explicit `placement` prop wins — e.g. AdLeaderboard always reports "strip"). */
export function placementForFile(file: string): AdPlacementId {
  const name = file.replace(/\.txt$/i, "");
  if (name === "rect-300x100") return "feed";
  if (STRIP_FILES.has(name)) return "strip";
  return "box";
}

/** Persisted placement config (`ad_settings.config`). Missing keys = current/default behaviour. */
export interface AdSettings {
  /** pageId → ads on that page (missing = on). */
  pages: Record<string, boolean>;
  /** zoneId → zone enabled (missing = on). */
  placements: Record<string, boolean>;
  inCard: {
    /** How many standalone ad cards a grid may insert per page (0 disables). */
    maxPerPage: number;
    /** Which slot feeds the grid ad cards. */
    slot: string;
  };
  /** Creative rotation interval in seconds. */
  rotationSeconds: number;
}

export const DEFAULT_AD_SETTINGS: AdSettings = {
  pages: {},
  placements: {},
  inCard: { maxPerPage: PINNED_IN_CARD_LIMIT, slot: "medium-rect-300x250" },
  rotationSeconds: 20,
};

/** Coerce whatever came back from `ad_settings.config` into a valid AdSettings (server sanitises too — this is belt & braces for stale/corrupt rows). */
export function mergeAdSettings(raw: unknown): AdSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pages: Record<string, boolean> = {};
  const placements: Record<string, boolean> = {};
  if (r.pages && typeof r.pages === "object") {
    for (const [k, v] of Object.entries(r.pages as Record<string, unknown>)) {
      if (typeof v === "boolean") pages[k] = v;
    }
  }
  if (r.placements && typeof r.placements === "object") {
    for (const [k, v] of Object.entries(r.placements as Record<string, unknown>)) {
      if (typeof v === "boolean") placements[k] = v;
    }
  }
  const inCardRaw = (r.inCard && typeof r.inCard === "object" ? r.inCard : {}) as Record<string, unknown>;
  const max = Number(inCardRaw.maxPerPage);
  const slot = typeof inCardRaw.slot === "string" && inCardRaw.slot.trim() ? inCardRaw.slot.trim() : DEFAULT_AD_SETTINGS.inCard.slot;
  const rot = Number(r.rotationSeconds);
  return {
    pages,
    placements,
    inCard: {
      maxPerPage: Number.isFinite(max) ? Math.max(0, Math.min(6, Math.round(max))) : DEFAULT_AD_SETTINGS.inCard.maxPerPage,
      slot,
    },
    rotationSeconds: Number.isFinite(rot) ? Math.max(5, Math.min(120, Math.round(rot))) : DEFAULT_AD_SETTINGS.rotationSeconds,
  };
}
