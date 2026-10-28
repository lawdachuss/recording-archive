-- Search acceleration for the recordings_with_links view.
-- The public endpoint uses substring ILIKE on these base-table columns;
-- pg_trgm GIN indexes support those patterns, while the two join/filter
-- indexes help the view avoid broad scans when narrowing linked recordings.
-- Apply this migration to the Supabase database as part of the release.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS recordings_username_trgm_idx
  ON public.recordings USING gin (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS recordings_room_title_trgm_idx
  ON public.recordings USING gin (room_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS recordings_filename_trgm_idx
  ON public.recordings USING gin (filename gin_trgm_ops);

CREATE INDEX IF NOT EXISTS recordings_tags_gin_idx
  ON public.recordings USING gin (tags);

CREATE INDEX IF NOT EXISTS upload_links_recording_id_idx
  ON public.upload_links (recording_id);

ANALYZE public.recordings;
