/**
 * Every ad placeholder the site renders — one entry per ads/*.txt file /
 * `ad_creatives.slot` value. Used by the Admin → Ads panel to list slots.
 *
 * Keep in sync with the SLOTS set in
 * artifacts/api-server/src/routes/admin-ads.ts (server-side validation).
 */
export interface AdSlotDef {
  /** Slot id — matches the ads/<file>.txt name and the DB `slot` column. */
  file: string;
  /** Human label for the admin panel. */
  label: string;
  /** Display size ("—" for full-slot placements). */
  size: string;
  /** Short hint shown above the add-form. */
  note: string;
}

export const AD_SLOTS: AdSlotDef[] = [
  { file: "billboard-970x250", label: "Billboard", size: "970×250", note: "Site-wide top strip (large screens)." },
  { file: "super-leaderboard-970x90", label: "Super Leaderboard", size: "970×90", note: "Spare wide slot (top strip alt)." },
  { file: "leaderboard-728x90", label: "Leaderboard", size: "728×90", note: "Footer, Browse top, VideoDetail, dividers." },
  { file: "banner-468x60", label: "Banner", size: "468×60", note: "Top strip + footer (medium screens)." },
  { file: "mobile-banner-320x50", label: "Mobile Banner", size: "320×50", note: "Site-wide top strip (phones)." },
  { file: "rect-300x100", label: "Rectangle (in-feed)", size: "300×100", note: "In-feed rows — Home, Browse, grids, above comments." },
  { file: "medium-rect-300x250", label: "Medium Rectangle", size: "300×250", note: "Sidebars, footer (phones), narrow pages, in-card ad layer on random video cards." },
  { file: "large-rect-336x280", label: "Large Rectangle", size: "336×280", note: "Spare rectangle slot." },
  { file: "half-page-300x600", label: "Half Page", size: "300×600", note: "VideoDetail sidebar (desktop)." },
  { file: "skyscraper-160x600", label: "Skyscraper", size: "160×600", note: "Spare sidebar skyscraper slot." },
  { file: "square-250x250", label: "Square", size: "250×250", note: "Spare square slot." },
  { file: "popunder", label: "Popunder", size: "—", note: "HTML/JS popunder code — one random creative fires once per page load." },
  { file: "direct-link", label: "Direct Links / Smartlinks", size: "—", note: "One URL per row — used by the Premium page's reward CTA. Paste pastes of multiple lines create one row each." },
];
