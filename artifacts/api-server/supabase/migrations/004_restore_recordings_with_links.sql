-- Restore the recordings_with_links view used by the public API.
-- The live database restore on 2026-07-31 included this view, but Render logs
-- now show PostgREST PGRST205 ("table not in schema cache") for every route
-- that reads it. Re-create it idempotently and refresh PostgREST's schema cache.

CREATE OR REPLACE VIEW public.recordings_with_links
  WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.channel_id,
  r.username,
  r.filename,
  r."timestamp",
  r.room_title,
  r.tags,
  r.viewers,
  r.resolution,
  r.framerate,
  r.filesize,
  r.duration,
  r.gender,
  r.thumbnail_url,
  r.sprite_url,
  r.embed_url,
  r.preview_url,
  r.sprite_vtt_url,
  r.instance_id,
  r.created_at,
  r.updated_at,
  NULLIF(
    jsonb_object_agg(ul.host, ul.url) FILTER (WHERE ul.host IS NOT NULL),
    '{}'::jsonb
  )::json AS links
FROM public.recordings AS r
LEFT JOIN public.upload_links AS ul ON r.id = ul.recording_id
GROUP BY r.id;

GRANT SELECT ON public.recordings_with_links TO anon, authenticated, service_role, postgres;

NOTIFY pgrst, 'reload schema';
