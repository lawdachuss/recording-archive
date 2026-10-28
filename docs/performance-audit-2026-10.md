# Performance audit and rollout guide — 2026-10-29

## Scope and verification level

This review covers the checked-in TypeScript API routes and Supabase migrations in
`recording-archive`, plus the relevant database/query patterns in `node-1`.
It is a source/schema review, not a measurement of the live service. No production
database query plan, Vercel trace, Redis dashboard, or load-test result was available
during this change. Treat the improvements below as targeted, testable optimizations;
do not infer a numeric speedup until production measurements confirm it.

## Current request path

- Vite SPA and static chunks are served by Vercel CDN; the existing `vercel.json`
  gives fingerprinted assets long immutable cache headers.
- The public API is built from `artifacts/api-server/src` into `api/index.mjs`
  during Vercel build. Source edits are the source of truth; do not hand-edit the
  generated 3 MB bundle.
- Heavy media proxying already uses the separate `api/media.mjs` function.
- The API already has response caching with stale serving/in-flight deduplication,
  route cache tags, a Redis bridge/fallback, rate limiting, and Redis hot/suggestion
  caches. Keep these paths; the goal is to reduce origin/database work on cache
  misses, not add another redundant cache layer.
- `recordings_with_links` is a left-join + JSON aggregation view that also includes
  recordings with no upload rows. Several playable-recording endpoints filtered it
  with `links IS NOT NULL`, making the database build the broader grouped view
  before discarding unplayable rows.

## Changes in this branch

### 1. Add a narrower playable-recording view

Migration `020-fast-linked-recordings-and-hot-path-indexes.sql` adds
`public.linked_recordings`, which starts from `upload_links` and joins only the
recordings that have a host link, then aggregates their links. It preserves the
existing `recordings_with_links` view for history/recommendation metadata lookups
that intentionally do not require a playable link.

The public list, suggestions, performer, stats, tags, and hot-recording paths are
updated to use the narrower view and no longer need a repeated
`.not("links", "is", "null")` predicate. The new view is granted to the same read
roles as the existing view and is marked `security_invoker = true`.

### 2. Index the observed filter/sort paths

The migration adds candidate indexes for:

- recording feeds sorted by timestamp, popularity/viewers, or filesize;
- performer, gender and resolution filters paired with timestamp sorting;
- history, saves, watch-later and collection reads ordered by user and recency;
- collection items ordered by playlist position;
- request queues, comment feeds and comment likes;
- unassigned worker channels separated by live/offline state.

Most are ordinary B-tree indexes; the existing trigram search indexes from migration
017 remain in place. No existing index is dropped, and no application data is
deleted. Additional indexes increase storage and write cost; check usage stats after
a representative workload before adding more.

### 3. Move dashboard aggregation into Postgres

The new `get_admin_stats()` RPC returns a single row with user, recording, performer
and request-status totals. The admin route calls it first; if the new RPC is absent
or the role is not allowed to execute it, the old aggregation path remains as a
compatibility fallback. When the migration is applied with the service-role API
credential configured, the normal dashboard request avoids fetching every request
row and every linked recording username into a serverless function.

The existing stats/tag/performer RPCs are also redirected to `linked_recordings`.
Their response columns are kept unchanged.

### 4. Make feed ordering stable

The recording and performer lists now include the recording ID as a final ordering
tie-breaker. This avoids rows with identical timestamps/viewer counts moving between
pages unpredictably, and lets the corresponding compound indexes satisfy the exact
sort order when the planner chooses them.

### 5. Keep build/test evidence visible

The branch adds a GitHub Actions quality workflow to run workspace/API typechecks,
API and SPA tests, Vercel serverless builds, and the frontend production build on a
pull request. This tests the checked-in source and regenerates the function bundle
inside CI; it does not deploy to production.

## Safe rollout sequence

1. Take a fresh database backup and verify that it can be restored before changing
   production schema.
2. Review migration 020 against the live schema, especially the types of
   `recordings.id`, `upload_links.recording_id`, `recordings.timestamp`,
   `upload_links.host` and `upload_links.url`. Do not use the bootstrap file as
   a substitute for inspecting a populated database.
3. On a large or busy production database, plan index creation for a quiet period:
   ordinary `CREATE INDEX` can delay writes while it builds. For large tables, have
   a DBA use equivalent `CREATE INDEX CONCURRENTLY` statements one at a time in
   a session that is not inside a transaction, then record the migration as applied
   using the team's established migration process. Do not blindly run both versions.
4. Apply the migration and confirm the new view and RPCs exist. Allow PostgREST's
   schema cache notification/reload to complete.
5. Deploy the API code only after the migration is available. A rolling deployment
   before the new view/RPC exists will create avoidable errors.
6. Smoke-test catalog page 1 and a later page, search, performers, tags, stats, hot
   recordings, and admin stats. Confirm cache warm/invalidation and worker uploads
   still behave as expected.
7. Compare origin p50/p95/p99 latency and 5xx rate, Vercel function duration/memory,
   Supabase/Postgres CPU and active connections, Redis bridge latency/error rate, and
   cache hit/stale-serve rates before and after. Keep or revert the code based on
   measurements, not assumptions.

## Post-deployment validation SQL

Run these read-only checks after migration 020 has been applied:

```sql
-- Verify the view and RPC signatures are visible.
SELECT table_schema, table_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN ('recordings_with_links', 'linked_recordings', 'channel_statistics');

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_site_stats', 'get_tag_counts', 'get_performer_stats', 'get_admin_stats'
  )
ORDER BY p.proname;

-- Use representative values and run ANALYZE only in a safe window:
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, username, filename, "timestamp", viewers
FROM public.linked_recordings
ORDER BY "timestamp" DESC NULLS LAST, id DESC
LIMIT 24;

-- Inspect newly added index usage after representative traffic has passed.
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname IN (
    'recordings_timestamp_id_desc_idx',
    'recordings_timestamp_id_asc_idx',
    'recordings_filesize_id_desc_idx',
    'recordings_username_timestamp_id_desc_idx',
    'recordings_gender_timestamp_id_desc_idx',
    'recordings_viewers_id_desc_idx',
    'recordings_gender_viewers_id_desc_idx',
    'recordings_resolution_timestamp_id_desc_idx',
    'watch_history_user_watched_at_desc_idx',
    'saved_videos_user_saved_at_desc_idx',
    'watch_later_user_added_at_asc_idx',
    'user_collection_items_collection_position_idx',
    'requests_status_created_at_desc_idx',
    'comments_recording_created_at_desc_idx',
    'channel_assignments_unassigned_live_username_idx'
  )
ORDER BY idx_scan ASC, indexrelname;
```

`EXPLAIN ANALYZE` executes the selected query. Use it carefully on a large live
catalog; run the query during low traffic and stop if it creates material load.
Index scans may remain low until the relevant endpoint is exercised, so do not
drop an index based on an empty counter immediately after deployment.

## Known follow-up candidates (not changed blindly)

- Exact catalog counts can become expensive at very large row counts. Changing them
  to approximate counts would affect the API contract/UI, so benchmark first and
  consider an explicitly-labelled estimate or a cached count RPC.
- Related/recommendation endpoints issue several sequential queries; a single purpose-
  built RPC could reduce round trips, but it should only be introduced with fixtures
  that prove its ranking semantics match the existing behavior.
- `fetchAll()` remains a fallback for stats, tags and performer aggregation, and is
  still used by some admin/reactions paths. Once production schema confirms the RPCs
  are consistently deployed, decide which fallbacks are worth retaining.
- A cache cannot make a slow uncached query safe at arbitrary concurrency. Test with
  realistic read/write mix and cache-cold bursts before making any claim about
  millions of concurrent users.
