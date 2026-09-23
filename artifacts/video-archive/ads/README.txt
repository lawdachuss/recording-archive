===============================================================================
 ADS FOLDER — paste your ad codes here (CrakRevenue / Adsterra / JuicyAds / …)
===============================================================================

Every .txt file in this folder is compiled into the website bundle. The site
finds its ad slots by FILE NAME, and each file can hold ONE OR MANY ad codes
that rotate automatically.

HOW TO PASTE AN AD
  1. Open the .txt file matching the slot size you bought (see table below).
  2. Paste the creative's HTML/JS code — e.g. <script src="…"></script>,
     an <iframe …></iframe>, or an <a href="…"><img src="…" width height></a>.
     OR simply paste the banner IMAGE URL on its own line (…/banner.gif) —
     each URL line auto-becomes a sized <img> creative and rotates too.
     Non-image URLs (smartlinks) belong in direct-link.txt, not here.
  3. Save the file, then rebuild/redeploy the site (in dev: it hot-reloads).

HOW ROTATION WORKS (multiple ads in one slot)
  - Every bare URL line is its own creative; for HTML codes, separate each
    additional creative with a line containing ONLY three
    dashes, on its own line:
        ---
  - The slot starts at a RANDOM creative, then swaps every 20 seconds,
    cycling through all creatives in that file.
  - Popunder: one random creative from popunder.txt fires once per page
    load (network codes are self-limiting per session).

IF A FILE IS EMPTY
  - Banner slots render a styled "Advertisement" placeholder at the exact
    reserved size (matches the site UI), so layout never jumps when you
    paste the real code.
  - Global slots (popunder) simply do nothing.

IMPORTANT NOTES
  - Codes are baked into the JS bundle at build time: after editing a file
    you must redeploy for the live site to pick it up.
  - File codes win over the legacy VITE_* env fallbacks (popunder, social
    bar, smartlink), so nothing can ever fire twice.
  - Lines that are only HTML comments ( <!-- … --> ) are ignored, so you can
    keep notes inside the files.
  - Keep ad codes out of login/signup/premium/admin pages — those routes are
    intentionally excluded by PremiumContext.isExcludedPage().
  - Premium users and visitors who have not passed the 18+ age gate never
    see any of these slots.

FILES & WHERE THEY RENDER
-------------------------------------------------------------------------------
  FILE                      SIZE        PLACEMENTS
-------------------------------------------------------------------------------
  billboard-970x250.txt     970x250     Site-wide top strip (large screens)
  super-leaderboard-970x90  970x90      Spare wide slot (top strip alt)
  leaderboard-728x90.txt    728x90      Footer (desktop), Browse top,
                                        VideoDetail above player, dividers
  banner-468x60.txt         468x60      Top strip + footer (medium screens)
  mobile-banner-320x50.txt  320x50      Site-wide top strip (phones)
  rect-300x100.txt          300x100     In-feed rows (CrakRevenue's recommended
                                        mobile header/footer rectangle) —
                                        Home, Browse, grids, above comments
  medium-rect-300x250.txt   300x250     Sidebars (VideoDetail), narrow-page
                                        banners, footer (phones)
  large-rect-336x280.txt    336x280     Spare rectangle slot
  half-page-300x600.txt     300x600     VideoDetail sidebar (desktop)
  skyscraper-160x600.txt    160x600     Spare sidebar skyscraper slot
  square-250x250.txt        250x250     Spare square slot
  popunder.txt              —           Site-wide popunder (Pop Codes) —
                                        injected once per page load
  socialbar.txt             —           Sticky social-bar script — loaded
                                        once per session site-wide
  direct-link.txt           —           Smartlink/Direct Link URLs — used as
                                        the default CTA link (one URL per line)
-------------------------------------------------------------------------------
