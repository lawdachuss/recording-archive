-- 012: ad placement controls (ad_settings) + creative ordering
--
-- Gives Admin → Ads a real control system:
--   * `ad_creatives.sort_order` — explicit rotation order (move up/down).
--   * `ad_settings` — a singleton jsonb config row controlling WHERE ads
--     render: per-page switches, per-zone switches (strips/in-feed/boxes/
--     in-card/popunder/reward CTA), the in-card layer (max per page + which
--     slot feeds it) and the rotation interval. Publicly readable (the site
--     needs it anonymously); writes only via the API server's service-role
--     client behind requireRole('admin'). Realtime-registered so open pages
--     pick up changes instantly.
-- Idempotent — safe to re-run in the Supabase SQL Editor.

ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- Backfill rotation order by creation time — first run only (guarded so a
-- re-run never clobbers orders an admin has set since).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ad_creatives)
     AND NOT EXISTS (SELECT 1 FROM public.ad_creatives WHERE sort_order <> 0) THEN
    UPDATE public.ad_creatives c
    SET sort_order = t.rn - 1
    FROM (
      SELECT id, row_number() OVER (PARTITION BY slot ORDER BY created_at, id) AS rn
      FROM public.ad_creatives
    ) t
    WHERE c.id = t.id;
  END IF;
END $$;

-- ─── ad_settings (singleton row, id = 1) ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ad_settings (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_settings_public_read ON public.ad_settings;
CREATE POLICY ad_settings_public_read ON public.ad_settings
  FOR SELECT
  USING (true);
-- No write policies: anon can read config but never change it.

-- Realtime so placement edits reach every open page instantly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'ad_settings'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_settings;
  END IF;
END $$;

-- Singleton row (config stays '{}' until the admin panel saves — every
-- missing key reads as "ads on" / current defaults).
INSERT INTO public.ad_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
