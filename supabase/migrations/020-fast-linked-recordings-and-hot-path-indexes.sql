-- 020-fast-linked-recordings-and-hot-path-indexes.sql
--
-- Performance hardening for the high-volume catalog, search, recommendation,
-- and user-library read paths. This migration is additive: it retains
-- recordings_with_links for callers that need unlinked recordings, and adds
-- linked_recordings for endpoints that explicitly require a playable recording.
--
-- Rollout: apply this migration BEFORE deploying code that reads linked_recordings.
-- Validate with the EXPLAIN examples in docs/performance-audit-2026-10.md.

CREATE OR REPLACE VIEW public.linked_recordings
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
  jsonb_object_agg(ul.host, ul.url)::json AS links
FROM public.upload_links AS ul
JOIN public.recordings AS r ON r.id = ul.recording_id
WHERE ul.host IS NOT NULL
GROUP BY r.id;

GRANT SELECT ON public.linked_recordings TO anon, authenticated, service_role, postgres;

-- Catalog list/recommendation ordering. IDs are included as deterministic
-- tie-breakers so adjacent pages do not shuffle rows with equal sort values.
CREATE INDEX IF NOT EXISTS recordings_timestamp_id_desc_idx
  ON public.recordings ("timestamp" DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS recordings_timestamp_id_asc_idx
  ON public.recordings ("timestamp" ASC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS recordings_filesize_id_desc_idx
  ON public.recordings (filesize DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS recordings_username_timestamp_id_desc_idx
  ON public.recordings (username, "timestamp" DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS recordings_gender_timestamp_id_desc_idx
  ON public.recordings (gender, "timestamp" DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS recordings_viewers_id_desc_idx
  ON public.recordings (viewers DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS recordings_gender_viewers_id_desc_idx
  ON public.recordings (gender, viewers DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS recordings_resolution_timestamp_id_desc_idx
  ON public.recordings (resolution, "timestamp" DESC NULLS LAST, id DESC);

-- User-specific reads used by history, saved videos, watch-later, and playlists.
CREATE INDEX IF NOT EXISTS watch_history_user_watched_at_desc_idx
  ON public.watch_history (user_id, watched_at DESC);

CREATE INDEX IF NOT EXISTS saved_videos_user_saved_at_desc_idx
  ON public.saved_videos (user_id, saved_at DESC);

CREATE INDEX IF NOT EXISTS watch_later_user_added_at_asc_idx
  ON public.watch_later_items (user_id, added_at ASC);

CREATE INDEX IF NOT EXISTS user_collections_user_created_at_desc_idx
  ON public.user_collections (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_collections_created_at_desc_idx
  ON public.user_collections (created_at DESC);

CREATE INDEX IF NOT EXISTS user_collection_items_collection_position_idx
  ON public.user_collection_items (collection_id, position ASC NULLS LAST, added_at DESC, id);

CREATE INDEX IF NOT EXISTS user_profiles_created_at_desc_idx
  ON public.user_profiles (created_at DESC);

-- Admin queues and comment feeds.
CREATE INDEX IF NOT EXISTS requests_user_created_at_desc_idx
  ON public.requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS requests_status_created_at_desc_idx
  ON public.requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS comments_recording_created_at_desc_idx
  ON public.comments (recording_id, created_at DESC);

CREATE INDEX IF NOT EXISTS comment_likes_comment_session_idx
  ON public.comment_likes (comment_id, session_id);

-- Node fleet queue: restrict candidate scans to unassigned, unclaimed work.
-- Existing idx_channel_assignments_assigned_node remains useful for node load counts.
CREATE INDEX IF NOT EXISTS channel_assignments_unassigned_live_username_idx
  ON public.channel_assignments (is_live, username)
  WHERE assigned_node IS NULL AND status = 'unassigned';

-- The public endpoints now use linked_recordings, keeping the old view's
-- backwards-compatible "all recordings, optionally with links" contract.
CREATE OR REPLACE FUNCTION public.get_site_stats()
RETURNS TABLE (
  total_recordings bigint,
  total_performers bigint,
  total_tags bigint,
  total_size_bytes bigint,
  newest_recording timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH active_recordings AS MATERIALIZED (
    SELECT username, tags, filesize, "timestamp"
    FROM public.linked_recordings
  ),
  recording_stats AS (
    SELECT
      count(*)::bigint AS total_recordings,
      count(DISTINCT username)::bigint AS total_performers,
      coalesce(sum(filesize), 0)::bigint AS total_size_bytes,
      max("timestamp") AS newest_recording
    FROM active_recordings
  ),
  tag_stats AS (
    SELECT count(DISTINCT tag)::bigint AS total_tags
    FROM active_recordings AS r
    CROSS JOIN LATERAL unnest(r.tags) AS t(tag)
    WHERE tag IS NOT NULL AND tag <> ''
  )
  SELECT
    r.total_recordings,
    r.total_performers,
    t.total_tags,
    r.total_size_bytes,
    r.newest_recording
  FROM recording_stats AS r
  CROSS JOIN tag_stats AS t;
$$;

CREATE OR REPLACE FUNCTION public.get_tag_counts()
RETURNS TABLE (tag text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT counts.tag, counts.usage_count
  FROM (
    SELECT t.tag, count(*)::bigint AS usage_count
    FROM public.linked_recordings AS r
    CROSS JOIN LATERAL unnest(r.tags) AS t(tag)
    WHERE t.tag IS NOT NULL AND t.tag <> ''
    GROUP BY t.tag
  ) AS counts
  ORDER BY counts.usage_count DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_performer_stats()
RETURNS TABLE (
  username text,
  recording_count bigint,
  gender text,
  latest_timestamp timestamptz,
  latest_thumbnail text,
  sprite_url text,
  pick_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH active_recordings AS MATERIALIZED (
    SELECT
      r.id,
      r.username,
      r.gender::text AS gender,
      r."timestamp",
      r.thumbnail_url,
      r.sprite_url,
      (
        r.thumbnail_url IS NOT NULL
        AND (
          regexp_replace(
            lower(split_part(split_part(r.thumbnail_url, '://', 2), '/', 1)),
            ':[0-9]+$',
            ''
          ) = 'pixhost.to'
          OR regexp_replace(
            lower(split_part(split_part(r.thumbnail_url, '://', 2), '/', 1)),
            ':[0-9]+$',
            ''
          ) LIKE '%.pixhost.to'
        )
      ) AS is_proxied_thumbnail
    FROM public.linked_recordings AS r
    WHERE r.username IS NOT NULL AND r.username <> ''
  ),
  performer_counts AS (
    SELECT
      username,
      count(*)::bigint AS recording_count,
      (array_agg(gender ORDER BY "timestamp" DESC NULLS LAST, id DESC)
        FILTER (WHERE gender IS NOT NULL))[1] AS gender,
      max("timestamp") AS latest_timestamp
    FROM active_recordings
    GROUP BY username
  ),
  preferred_rows AS (
    SELECT DISTINCT ON (username)
      username, id, thumbnail_url, sprite_url
    FROM active_recordings
    ORDER BY
      username,
      CASE
        WHEN is_proxied_thumbnail THEN 0
        WHEN thumbnail_url IS NOT NULL THEN 1
        ELSE 2
      END,
      "timestamp" DESC NULLS LAST,
      id DESC
  ),
  latest_rows AS (
    SELECT DISTINCT ON (username)
      username, sprite_url
    FROM active_recordings
    ORDER BY username, "timestamp" DESC NULLS LAST, id DESC
  )
  SELECT
    c.username,
    c.recording_count,
    c.gender,
    c.latest_timestamp,
    coalesce(p.thumbnail_url, p.sprite_url) AS latest_thumbnail,
    coalesce(p.sprite_url, l.sprite_url) AS sprite_url,
    p.id AS pick_id
  FROM performer_counts AS c
  JOIN preferred_rows AS p USING (username)
  LEFT JOIN latest_rows AS l USING (username);
$$;

GRANT EXECUTE ON FUNCTION public.get_site_stats() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tag_counts() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_performer_stats() TO anon, authenticated, service_role;

-- Admin counts are computed in Postgres and return one row instead of streaming
-- all requests / performer rows into a serverless function.
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS TABLE (
  users bigint,
  recordings bigint,
  performers bigint,
  request_total bigint,
  request_pending bigint,
  request_approved bigint,
  request_rejected bigint,
  request_done bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT count(*)::bigint FROM public.user_profiles),
    (SELECT count(*)::bigint FROM public.recordings),
    (SELECT count(DISTINCT username)::bigint
       FROM public.linked_recordings
      WHERE username IS NOT NULL AND username <> ''),
    (SELECT count(*)::bigint FROM public.requests),
    (SELECT count(*)::bigint FROM public.requests WHERE status = 'pending'),
    (SELECT count(*)::bigint FROM public.requests WHERE status = 'approved'),
    (SELECT count(*)::bigint FROM public.requests WHERE status = 'rejected'),
    (SELECT count(*)::bigint FROM public.requests WHERE status = 'done');
$$;

REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO service_role, postgres;

NOTIFY pgrst, 'reload schema';
