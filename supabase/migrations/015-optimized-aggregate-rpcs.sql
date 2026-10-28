-- Fast, database-side aggregations used by /api/stats and /api/tags.
-- Keep these functions local to the schema and avoid multiplying recording
-- counts/byte totals by the number of tags on each row.

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
    SELECT username, tags, filesize, timestamp
    FROM public.recordings_with_links
    WHERE links IS NOT NULL
  ),
  recording_stats AS (
    SELECT
      count(*)::bigint AS total_recordings,
      count(DISTINCT username)::bigint AS total_performers,
      coalesce(sum(filesize), 0)::bigint AS total_size_bytes,
      max(timestamp) AS newest_recording
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
RETURNS TABLE (
  tag text,
  count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT counts.tag, counts.usage_count
  FROM (
    SELECT u.tag, count(*)::bigint AS usage_count
    FROM public.recordings_with_links AS r
    CROSS JOIN LATERAL unnest(r.tags) AS u(tag)
    WHERE r.links IS NOT NULL
      AND u.tag IS NOT NULL
      AND u.tag <> ''
    GROUP BY u.tag
  ) AS counts
  ORDER BY counts.usage_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_site_stats() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tag_counts() TO anon, authenticated, service_role;
