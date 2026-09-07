-- 003_activity_events_meta.sql - structured attributes for activity events.
-- Beyond name/value/path/ts, events can carry arbitrary structured context:
--   recording_view -> { "recording_id": "..." }
--   search         -> { "q": "query text" }
--   page_view      -> { "route": "/video/abc" }
-- JSONB is schemaless, so new event types need no migration.
--
-- Safe to re-run. Apply in the Supabase SQL editor.

ALTER TABLE public.activity_events
  ADD COLUMN IF NOT EXISTS meta jsonb;

-- GIN index for queries that filter on meta keys (e.g. count views per
-- recording_id). Only worth it once meta is used heavily; harmless to keep.
CREATE INDEX IF NOT EXISTS idx_activity_events_meta_gin
  ON public.activity_events USING GIN (meta);

REVOKE ALL ON public.activity_events FROM anon, authenticated;
GRANT ALL ON public.activity_events TO service_role;