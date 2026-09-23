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
    the in-card layer picks a random creative per page load.
    Popunder: ONE random creative fires once per page load, maximum.
  * Popunder.html and direct-link.txt (smartlink URLs) take the same
    content types — they are also managed from Admin → Ads.

SLOT INVENTORY (13 placeholders — admin panel lists them all)
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
                                        phones, AND the in-card ad layer on
                                        random video cards (max 2 per page,
                                        <2 per page, fits inside thumbnails)
  large-rect-336x280          336 x 280 spare rectangle slot
  half-page-300x600           300 x 600 VideoDetail sidebar (desktop)
  skyscraper-160x600          160 x 600 spare sidebar skyscraper slot
  square-250x250              250 x 250 spare square slot
  popunder                    —         HTML/JS popunder code, once/pageload
  direct-link                 —         smartlink URLs (one per row); used
                                        by the Premium page reward CTA

IMPORTANT NOTES
---------------
  * VITE_ADS_ENABLED: empty/unset = ON. Set to "false" to hide ALL ads.
  * Ads never show for premium members or before the age gate is passed,
    and never on: login, signup, auth callback, premium, admin, RandomRedirect.
  * All networks are CrakRevenue-only. No Adsterra/JuicyAds/ExoClick code,
    env keys or routes exist anywhere anymore.
  * Still applies to file fallback content: paste codes at build time and
    they're baked into the JS bundle — a redeploy is required for FILE
    edits. Admin-panel edits are instant.
  * verify-ads script: node "C:\Users\basud\AppData\Local\Temp\opencode\verify-ads.mjs" "<path-to-this-ads-folder>"
