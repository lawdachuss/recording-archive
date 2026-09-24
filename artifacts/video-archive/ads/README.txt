VAULT BANNER SLOTS — HOW THEY WORK
===================================

ADS ARE NOW MANAGED FROM THE ADMIN PANEL (Supabase), NOT FROM THESE FILES.

  Admin → Ads  (/admin/ads)
    - Add, edit, enable/disable and delete creatives for EVERY placeholder
      below, from the browser.
    - Saved in the Supabase `ad_creatives` table (migration 011-ads.sql).
    - Every change goes live on ALL open pages immediately (Supabase
      realtime) — no rebuild, no redeploy.

  The .txt files in this folder are the BUILD-TIME FALLBACK only: they are
  served when the `ad_creatives` table can't be reached (migration not run,
  network failure). Once the table exists it is authoritative — including
  for empty slots (deleting a slot's last creative in the admin panel
  really does remove the ads there).

  If you run the site locally without Supabase, paste creatives directly
  into the files below and they will show.

FILE FORMAT (same in files and in the admin panel)
---------------------------------------------------
  * One creative per entry.
  * A bare image URL renders as a contained <img> that fits any slot.
    (e.g. https://cdn.example.com/banner-300x250.gif)
  * Anything else is treated as raw HTML/JS ad code and injected as-is.
  * In the files: separate multiple creatives with a line containing only ---
    Lines starting with <!-- are comments (headers) and are ignored.
  * Empty slot = styled placeholder at the slot's size.
  * Rotation: components cycle creatives every 20s from a random start;
    each in-feed ad card picks a random creative per page load.
    Popunder: ONE random creative fires once per page load, maximum.
  * Popunder.html and direct-link.txt (smartlink URLs) take the same
    content types — they are also managed from Admin → Ads.

SLOT INVENTORY (14 placeholders — admin panel lists them all)
-------------------------------------------------------------
  File                        Size      Used on
  --------------------------- --------- -----------------------------------
  billboard-970x250           970 x 250 spare wide slot (top strip alt)
  super-leaderboard-970x90    970 x 90  spare wide slot (top strip alt)
  leaderboard-728x90          728 x 90  footer, Browse top, VideoDetail,
                                        dividers (default AdLeaderboard lg)
  banner-468x60               468 x 60  top strip + footer (md tier)
  mobile-banner-320x50        320 x 50  site-wide top strip (phones)
  rect-300x100                300 x 100 in-feed rows — Home, Browse, grids,
                                        above comments (default AdLeaderboard
                                        mobile)
  medium-rect-300x250         300 x 250 VideoDetail sidebar (all sizes),
                                        narrow page banners, footer on
                                        phones, AND the standalone ad cards
                                        grids insert (max 2 per page, own
                                        cell — never over a video)
  large-rect-336x280          336 x 280 spare rectangle slot
  half-page-300x600           300 x 600 VideoDetail sidebar (desktop)
  skyscraper-160x600          160 x 600 spare sidebar skyscraper slot
  square-250x250              250 x 250 spare square slot
  popunder                    —         HTML/JS popunder code, once/pageload
  direct-link                 —         smartlink URLs (one per row); used
                                        by the Premium page reward CTA
  preroll                     —         pre-roll video URLs (one per row);
                                        one plays at random before the main
                                        video on Video detail pages, skip
                                        after 5s

IMPORTANT NOTES
---------------
  * VITE_ADS_ENABLED: empty/unset = ON. Set to "false" to hide ALL ads.
  * Ads never show for premium members or before the age gate is passed,
    and never on: login, signup, auth callback, premium, admin, RandomRedirect.
  * All network codes: CrakRevenue (slot codes) + StripCash/Stripchat
    (smartlink from the server-side STRIPCASH_API_KEY — see
    GET /api/ads/stripcash; banner/popunder codes paste into slots as HTML).
    Adsterra and JuicyAds are deliberately NOT integrated — no codes, env
    keys or routes for them exist anywhere.
  * Still applies to file fallback content: paste codes at build time and
    they're baked into the JS bundle — a redeploy is required for FILE
    edits. Admin-panel edits are instant.
  * verify-ads script: node "C:\Users\basud\AppData\Local\Temp\opencode\verify-ads.mjs" "<path-to-this-ads-folder>"
