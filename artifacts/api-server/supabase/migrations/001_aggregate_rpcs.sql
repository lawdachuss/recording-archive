-- 001_aggregate_rpcs.sql - Postgres RPCs that replace full-table fetchAll()
-- aggregation in the API (tags.ts, stats.ts).
--
-- Why: the API currently streams every row of recordings_with_links through
-- PostgREST and aggregates in JS. At scale that's a cache-miss storm waiting
-- to happen. These functions do the work in the database and return tiny
-- payloads. PostgREST exposes them automatically at:
--   POST /rest/v1/rpc/get_tag_counts
--   POST /rest/v1/rpc/get_site_stats
--
-- Safe to re-run (CREATE OR REPLACE). No table changes.
-- ASCII-only comments + schema-qualified identifiers so this pastes cleanly
-- into any SQL editor regardless of encoding or search_path.

-- Tag counts: unnest + count in Postgres, same shape as the old JS
-- aggregation (rows that have a link, null/empty tags skipped, count desc).
CREATE OR REPLACE FUNCTION public.get_tag_counts()
RETURNS TABLE (tag text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.tag, count(*)::bigint AS count
  FROM public.recordings_with_links r,
       unnest(r.tags) AS t(tag)
  WHERE r.links IS NOT NULL
    AND r.tags IS NOT NULL
    AND t.tag IS NOT NULL
    AND t.tag <> ''
  GROUP BY t.tag
  ORDER BY count DESC;
$$;

-- Site stats: one-pass aggregate over the same view. Equivalent to the old
-- JS stats: total recordings with links, distinct performers, distinct tags,
-- total filesize, newest timestamp.
CREATE OR REPLACE FUNCTION public.get_site_stats()
RETURNS TABLE (
  total_recordings bigint,
  total_performers bigint,
  total_tags bigint,
  total_size_bytes bigint,
  newest_recording timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)::bigint AS total_recordings,
    count(DISTINCT r.username)::bigint AS total_performers,
    (SELECT count(DISTINCT t.tag)::bigint
       FROM public.recordings_with_links r2,
            unnest(r2.tags) AS t(tag)
      WHERE r2.links IS NOT NULL
        AND r2.tags IS NOT NULL
        AND t.tag IS NOT NULL
        AND t.tag <> '') AS total_tags,
    COALESCE(sum(r.filesize), 0)::bigint AS total_size_bytes,
    max(r.timestamp) AS newest_recording
  FROM public.recordings_with_links r
  WHERE r.links IS NOT NULL;
$$;

-- Grants: the API uses the service_role key (bypasses RLS). Expose to
-- anon/authenticated too so the RPCs could be called through PostgREST with
-- user tokens if ever needed. Read-only functions.
GRANT EXECUTE ON FUNCTION public.get_tag_counts() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_site_stats() TO anon, authenticated, service_role;