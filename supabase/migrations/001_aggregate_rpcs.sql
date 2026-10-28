-- Aggregate RPC functions for high performance API responses
-- 1. get_site_stats: returns site-wide statistics in one query
CREATE OR REPLACE FUNCTION public.get_site_stats()
RETURNS TABLE (
  total_recordings bigint,
  total_performers bigint,
  total_tags bigint,
  total_size_bytes bigint,
  newest_recording timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH active_recordings AS (
    SELECT username, tags, filesize, timestamp
    FROM public.recordings_with_links
    WHERE links IS NOT NULL
  )
  SELECT
    count(*)::bigint AS total_recordings,
    count(DISTINCT username)::bigint AS total_performers,
    count(DISTINCT unnested_tag)::bigint AS total_tags,
    coalesce(sum(filesize), 0)::bigint AS total_size_bytes,
    max(timestamp) AS newest_recording
  FROM active_recordings
  LEFT JOIN LATERAL unnest(tags) AS unnested_tag ON true;
$$;

-- 2. get_tag_counts: aggregates tag usage counts in database
CREATE OR REPLACE FUNCTION public.get_tag_counts()
RETURNS TABLE (
  tag text,
  count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    unnested_tag AS tag,
    count(*)::bigint AS count
  FROM public.recordings_with_links,
  UNNEST(tags) AS unnested_tag
  WHERE links IS NOT NULL
    AND unnested_tag IS NOT NULL
    AND unnested_tag <> ''
  GROUP BY unnested_tag
  ORDER BY count DESC;
$$;

-- 3. increment_viewer_count: atomically increments recording viewer count and returns new count
CREATE OR REPLACE FUNCTION public.increment_viewer_count(p_recording_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_count bigint;
BEGIN
  UPDATE public.recordings
  SET viewers = coalesce(viewers, 0) + 1
  WHERE id = p_recording_id
  RETURNING viewers INTO v_new_count;

  RETURN coalesce(v_new_count, 0);
END;
$$;
