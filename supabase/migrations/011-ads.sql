--011: admin-managed ad creatives (ad_creatives)
--
-- Moves ad content out of the git-tracked ads/*.txt files into Supabase:
-- the Admin -> Ads panel CRUDs rows here, and every open page picks edits
-- up in REALTIME (postgres_changes subscription in AdsContext). The
-- ads/*.txt files remain as the build-time FALLBACK for when this table
-- is unreachable (migration not run, network failure) — once this table
-- exists it is AUTHORITATIVE, including for empty slots.
--
-- RLS: public read (ads are public content); no anon writes — admin CRUD
-- only happens through the API server's service-role client behind
-- requireRole('admin'). Idempotent — safe to re-run in the SQL Editor.

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot       text NOT NULL,                 -- slot name, e.g. 'medium-rect-300x250'
  kind       text NOT NULL DEFAULT 'html' CHECK (kind IN ('html', 'url')),
  content    text NOT NULL,                 -- HTML/JS code, or a bare image/smartlink URL
  enabled    boolean NOT NULL DEFAULT true, -- disabled rows stay but never render
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fill in columns that may be missing on older/bootstrapped installs.
ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Read pattern: the site and the admin panel both list per slot.
CREATE INDEX IF NOT EXISTS idx_ad_creatives_slot ON public.ad_creatives (slot);

-- ─── Row Level Security ──────────────────────────────────────────────────
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_creatives_public_read ON public.ad_creatives;
CREATE POLICY ad_creatives_public_read ON public.ad_creatives
  FOR SELECT
  USING (true);
-- No INSERT/UPDATE/DELETE policies: the anon key can never write ads.
-- Admin writes use the service-role client (bypasses RLS) in
-- artifacts/api-server/src/routes/admin-ads.ts.

-- ─── Realtime ────────────────────────────────────────────────────────────
-- Register with Supabase Realtime so AdsContext's postgres_changes
-- subscription delivers live ad edits to every open page. No-op when the
-- publication doesn't exist or already includes the table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'ad_creatives'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_creatives;
  END IF;
END $$;

-- ─── Seed (first run only) ───────────────────────────────────────────────
-- Import the creatives already living in ads/*.txt so the site shows
-- exactly what it showed before this migration. Skipped as soon as any
-- row exists, so re-running never resurrects deleted ads.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ad_creatives LIMIT 1) THEN RETURN; END IF;
  INSERT INTO public.ad_creatives (slot, kind, content) VALUES
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_300250_sara_fun_en.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_25_300250_en_1.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_1_300250_en_4.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_5_300250_en_9.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_26_300250_en_2.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_232_300250_du_3.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_234_300250_du_1.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8780/JM-379_DESIGN-20352_VixenMinx-BoobsGif_300250.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8780/JM-645_DESIGN-22633_BANN5_RANDOMHOTTIES_DAINTYWILDER_TXT_300250.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006611AX_FCAM_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006664M_FCAM_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/003672AU_MYFC_18_ALL_EN_71_E.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006611V_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006654A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/20180815140636-006605A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006271A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005250A_MYFC_18_ALL_EN_71_N.jpg'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005449B_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006611U_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005449B_MYFC_18_ALL_DE_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005438A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/003496H_MYFC_18_ALL_EN_71_N.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/9945/Cam4_Naughty-Girls_EN_300250_02.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/9945/Cam4_Naughty-Girls_EN_300250_01.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/005973D_LIFF_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/006491C_LIFF_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000012I_EXWC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000012J_EXWC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000081A_EXWC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000156A_SLUT_18_ALL_EN_71_E.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/2676/LiveJasmin_Horny-Estee_EN_3002500_05.jpg'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/2676/001753A_LIJA_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8135/011630A_ROYA_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8135/011632A_ROYA_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8135/B1-300x250.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/008565A_SLUT_18_ALL_EN_71_L.jpg'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/010726G_SLUT_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/005199G_SLUT_18_ALL_ES_71_E.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/010726G_SLUT_18_ALL_EN_71_L.gif');
END $$;
