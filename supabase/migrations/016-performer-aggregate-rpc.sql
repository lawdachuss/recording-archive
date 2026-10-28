-- Fast database-side performer aggregation used by recording-archive /api/performers.
-- Returning one row per performer avoids streaming every recording over PostgREST
-- and aggregating the entire catalogue in each cold Vercel function instance.

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
      r.timestamp,
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
    FROM public.recordings_with_links AS r
    WHERE r.links IS NOT NULL
      AND r.username IS NOT NULL
      AND r.username <> ''
  ),
  performer_counts AS (
    SELECT
      username,
      count(*)::bigint AS recording_count,
      (array_agg(gender ORDER BY timestamp DESC NULLS LAST, id DESC)
        FILTER (WHERE gender IS NOT NULL))[1] AS gender,
      max(timestamp) AS latest_timestamp
    FROM active_recordings
    GROUP BY username
  ),
  preferred_rows AS (
    SELECT DISTINCT ON (username)
      username,
      id,
      thumbnail_url,
      sprite_url
    FROM active_recordings
    ORDER BY
      username,
      CASE
        WHEN is_proxied_thumbnail THEN 0
        WHEN thumbnail_url IS NOT NULL THEN 1
        ELSE 2
      END,
      timestamp DESC NULLS LAST,
      id DESC
  ),
  latest_rows AS (
    SELECT DISTINCT ON (username)
      username,
      sprite_url
    FROM active_recordings
    ORDER BY username, timestamp DESC NULLS LAST, id DESC
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

GRANT EXECUTE ON FUNCTION public.get_performer_stats() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
