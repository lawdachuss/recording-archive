-- 002_activity_events.sql - RUM/activity event store for the Stage 1
-- activity pipeline (client beacon -> /api/rum -> Redis Stream -> batched
-- insert here).
--
-- Idempotency: `id` is the Redis stream entry id (plus a per-metric suffix),
-- so the flusher can safely re-insert the same entry after a redelivery
-- (consumer group at-least-once) without creating duplicates.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.activity_events (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  value        double precision NOT NULL,
  path         text,
  ts           bigint,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

-- "Continue watching / top metrics" style reads: recent first.
CREATE INDEX IF NOT EXISTS idx_activity_events_recorded
  ON public.activity_events (recorded_at DESC);

-- Aggregate-by-metric reads (dashboards, analytics).
CREATE INDEX IF NOT EXISTS idx_activity_events_name_ts
  ON public.activity_events (name, recorded_at DESC);

-- RLS on: the table is only written by the API (service_role key bypasses
-- RLS). anon/authenticated get nothing — this is analytics data, not user data.
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.activity_events FROM anon, authenticated;
GRANT ALL ON public.activity_events TO service_role;