-- RECORDING ARCHIVE — ALL-IN-ONE SUPABASE SQL
-- Target: a NEW / EMPTY Supabase project. Apply once in SQL Editor.
-- This creates schema objects only; it does not import recording data or auth users.
-- Core table definitions are taken from database/schema.sql at historical commit c251547e4779132899874a16445f33acc3d1fe33.
-- Current migrations 001 and 003–020 are included in order. Migration 002 is absent from this repository.
-- SECURITY: legacy blanket "allow all" policies from the historical snapshot are not copied.
-- The legacy database/restore-2026-07-31.sql worker RPCs were excluded because they
-- reference columns and recording-lock semantics that do not match the core snapshot.

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Sequences referenced by legacy integer-ID columns
CREATE SEQUENCE IF NOT EXISTS public.comment_likes_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.comments_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.performer_follows_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.reactions_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.requests_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.saved_videos_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.user_collection_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.user_notifications_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.watch_history_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.watch_later_items_id_seq;

-- Core tables from historical database/schema.sql
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" varchar(255) NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "channel_assignments" (
  "username" text NOT NULL,
  "site" text NOT NULL DEFAULT 'chaturbate'::text,
  "assigned_node" text,
  "status" text NOT NULL DEFAULT 'unassigned'::text,
  "is_live" boolean NOT NULL DEFAULT false,
  "live_checked_at" timestamptz,
  "assigned_at" timestamptz,
  "last_heartbeat" timestamptz,
  "framerate" integer NOT NULL DEFAULT 60,
  "resolution" integer NOT NULL DEFAULT 2160,
  "pattern" text NOT NULL DEFAULT ''::text,
  "max_duration" integer NOT NULL DEFAULT 60,
  "max_filesize" integer NOT NULL DEFAULT 0,
  "compress" boolean NOT NULL DEFAULT false,
  "min_duration_before_upload" integer NOT NULL DEFAULT 1200,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "last_recorded_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "channels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "username" varchar(255) NOT NULL,
  "is_paused" boolean DEFAULT false,
  "framerate" integer DEFAULT 30,
  "resolution" integer DEFAULT 1080,
  "pattern" text DEFAULT 'videos/{{.Username}}_{{.Year}}-{{.Month}}-{{.Day}}_{{.Hour}}-{{.Minute}}-{{.Second}}{{if .Sequence}}_{{.Sequence}}{{end}}'::text,
  "max_duration" integer DEFAULT 0,
  "max_filesize" integer DEFAULT 0,
  "compress" boolean DEFAULT false,
  "created_at" bigint NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "comment_likes" (
  "id" integer NOT NULL DEFAULT nextval('comment_likes_id_seq'::regclass),
  "comment_id" integer NOT NULL,
  "session_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "comments" (
  "id" integer NOT NULL DEFAULT nextval('comments_id_seq'::regclass),
  "recording_id" text NOT NULL,
  "parent_id" integer,
  "author" text NOT NULL,
  "content" text NOT NULL,
  "session_id" text,
  "deleted" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "disk_usage" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "total_bytes" bigint NOT NULL,
  "used_bytes" bigint NOT NULL,
  "free_bytes" bigint NOT NULL,
  "percent_used" integer NOT NULL,
  "recorded_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "nodes" (
  "node_id" text NOT NULL,
  "hostname" text NOT NULL DEFAULT ''::text,
  "instance_label" text NOT NULL DEFAULT ''::text,
  "software_version" text NOT NULL DEFAULT ''::text,
  "status" text NOT NULL DEFAULT 'offline'::text,
  "current_load" integer NOT NULL DEFAULT 0,
  "last_heartbeat" timestamptz NOT NULL DEFAULT now(),
  "web_url" text NOT NULL DEFAULT ''::text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "session_deadline" timestamptz
);

CREATE TABLE IF NOT EXISTS "performer_follows" (
  "id" integer NOT NULL DEFAULT nextval('performer_follows_id_seq'::regclass),
  "user_id" text NOT NULL,
  "performer_username" text NOT NULL,
  "followed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "pipeline_states" (
  "file_hash" text NOT NULL,
  "file_path" text NOT NULL,
  "filename" text NOT NULL,
  "username" text NOT NULL DEFAULT ''::text,
  "file_size" bigint DEFAULT 0,
  "current_stage" text NOT NULL DEFAULT 'thumbnail'::text,
  "failed" boolean DEFAULT false,
  "last_error" text DEFAULT ''::text,
  "thumb_url" text DEFAULT ''::text,
  "sprite_url" text DEFAULT ''::text,
  "preview_url" text DEFAULT ''::text,
  "embed_url" text DEFAULT ''::text,
  "links" text DEFAULT '{}'::text,
  "retries" integer NOT NULL DEFAULT 0,
  "node_id" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "pool_autopilot" (
  "username" text NOT NULL,
  "gender" text NOT NULL,
  "viewers" integer NOT NULL DEFAULT 0,
  "added_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "preview_images" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "recording_id" uuid,
  "filename" varchar(500) NOT NULL,
  "thumbnail_url" text,
  "sprite_url" text,
  "preview_url" text,
  "instance_id" text NOT NULL DEFAULT 'default'::text,
  "uploaded_at" timestamptz DEFAULT now(),
  "sprite_vtt_url" text
);

CREATE TABLE IF NOT EXISTS "reactions" (
  "id" integer NOT NULL DEFAULT nextval('reactions_id_seq'::regclass),
  "recording_id" text NOT NULL,
  "session_id" text NOT NULL,
  "type" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "recordings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "channel_id" uuid,
  "username" varchar(255) NOT NULL,
  "filename" varchar(500) NOT NULL,
  "timestamp" timestamptz NOT NULL,
  "room_title" text,
  "tags" text[],
  "viewers" integer DEFAULT 0,
  "resolution" varchar(50),
  "framerate" integer,
  "filesize" bigint DEFAULT 0,
  "duration" double precision DEFAULT 0,
  "gender" varchar(50),
  "thumbnail_url" text,
  "sprite_url" text,
  "embed_url" text,
  "preview_url" text,
  "seekstreaming_poster_url" text,
  "seekstreaming_preview_url" text,
  "instance_id" text NOT NULL DEFAULT 'default'::text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "sprite_vtt_url" text
);

CREATE TABLE IF NOT EXISTS "requests" (
  "id" integer NOT NULL DEFAULT nextval('requests_id_seq'::regclass),
  "user_id" text NOT NULL,
  "platform" text NOT NULL DEFAULT 'chaturbate'::text,
  "performer_username" text,
  "stream_link" text,
  "notes" text,
  "priority" text NOT NULL DEFAULT 'normal'::text,
  "status" text NOT NULL DEFAULT 'pending'::text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "saved_videos" (
  "id" integer NOT NULL DEFAULT nextval('saved_videos_id_seq'::regclass),
  "user_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "saved_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "tunnels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "url" text NOT NULL,
  "run_id" integer,
  "is_active" boolean DEFAULT true,
  "instance_id" text NOT NULL DEFAULT 'default'::text,
  "created_at" timestamptz DEFAULT now(),
  "expires_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "upload_journal" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "file_hash" text NOT NULL,
  "filename" text NOT NULL,
  "host" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending'::text,
  "error_msg" text,
  "file_size" bigint,
  "instance_id" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "upload_links" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "recording_id" uuid,
  "host" varchar(100) NOT NULL,
  "url" text NOT NULL,
  "instance_id" text NOT NULL DEFAULT 'default'::text,
  "uploaded_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_collection_items" (
  "id" integer NOT NULL DEFAULT nextval('user_collection_items_id_seq'::regclass),
  "collection_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "added_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_collections" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" integer NOT NULL DEFAULT nextval('user_notifications_id_seq'::regclass),
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "message" text NOT NULL,
  "related_id" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_profiles" (
  "user_id" text NOT NULL,
  "display_name" text,
  "avatar_url" text,
  "bio" text,
  "username" text,
  "email" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_roles" (
  "user_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'user'::text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "watch_history" (
  "id" integer NOT NULL DEFAULT nextval('watch_history_id_seq'::regclass),
  "user_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "watched_at" timestamptz NOT NULL DEFAULT now(),
  "progress_seconds" integer NOT NULL DEFAULT 0,
  "duration_seconds" integer
);

CREATE TABLE IF NOT EXISTS "watch_later_items" (
  "id" integer NOT NULL DEFAULT nextval('watch_later_items_id_seq'::regclass),
  "user_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "added_at" timestamptz NOT NULL DEFAULT now()
);

-- Constraints after all referenced tables exist
ALTER TABLE "app_settings" ADD PRIMARY KEY ("key");
ALTER TABLE "channel_assignments" ADD PRIMARY KEY ("username", "site");
ALTER TABLE "channel_assignments" ADD CONSTRAINT "channel_assignments_assigned_node_fkey" FOREIGN KEY (assigned_node) REFERENCES nodes(node_id);
ALTER TABLE "channel_assignments" ADD CONSTRAINT "channel_assignments_site_check" CHECK ((site = ANY (ARRAY['chaturbate'::text, 'stripchat'::text])));
ALTER TABLE "channel_assignments" ADD CONSTRAINT "channel_assignments_status_check" CHECK ((status = ANY (ARRAY['unassigned'::text, 'claimed'::text, 'recording'::text, 'paused'::text, 'error'::text])));
ALTER TABLE "channels" ADD PRIMARY KEY ("id");
ALTER TABLE "channels" ADD CONSTRAINT "channels_username_key" UNIQUE (username);
ALTER TABLE "comment_likes" ADD PRIMARY KEY ("id");
ALTER TABLE "comments" ADD PRIMARY KEY ("id");
ALTER TABLE "disk_usage" ADD PRIMARY KEY ("id");
ALTER TABLE "nodes" ADD PRIMARY KEY ("node_id");
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_status_check" CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text, 'draining'::text])));
ALTER TABLE "performer_follows" ADD PRIMARY KEY ("id");
ALTER TABLE "performer_follows" ADD CONSTRAINT "performer_follows_uniq" UNIQUE (user_id, performer_username);
ALTER TABLE "pipeline_states" ADD PRIMARY KEY ("file_hash");
ALTER TABLE "pool_autopilot" ADD PRIMARY KEY ("username");
ALTER TABLE "preview_images" ADD PRIMARY KEY ("id");
ALTER TABLE "preview_images" ADD CONSTRAINT "preview_images_filename_key" UNIQUE (filename);
ALTER TABLE "preview_images" ADD CONSTRAINT "preview_images_recording_id_fkey" FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
ALTER TABLE "reactions" ADD PRIMARY KEY ("id");
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_recording_session_uniq" UNIQUE (recording_id, session_id);
ALTER TABLE "recordings" ADD PRIMARY KEY ("id");
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_filename_key" UNIQUE (filename);
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_channel_id_fkey" FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
ALTER TABLE "requests" ADD PRIMARY KEY ("id");
ALTER TABLE "saved_videos" ADD PRIMARY KEY ("id");
ALTER TABLE "saved_videos" ADD CONSTRAINT "saved_videos_uniq" UNIQUE (user_id, recording_id);
ALTER TABLE "tunnels" ADD PRIMARY KEY ("id");
ALTER TABLE "upload_journal" ADD PRIMARY KEY ("id");
ALTER TABLE "upload_journal" ADD CONSTRAINT "upload_journal_file_hash_host_key" UNIQUE (file_hash, host);
ALTER TABLE "upload_links" ADD PRIMARY KEY ("id");
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_recording_host_unique" UNIQUE (recording_id, host);
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_recording_id_fkey" FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
ALTER TABLE "user_collection_items" ADD PRIMARY KEY ("id");
ALTER TABLE "user_collection_items" ADD CONSTRAINT "collection_items_uniq" UNIQUE (collection_id, recording_id);
ALTER TABLE "user_collection_items" ADD CONSTRAINT "user_collection_items_collection_id_fkey" FOREIGN KEY (collection_id) REFERENCES user_collections(id) ON DELETE CASCADE;
ALTER TABLE "user_collections" ADD PRIMARY KEY ("id");
ALTER TABLE "user_notifications" ADD PRIMARY KEY ("id");
ALTER TABLE "user_profiles" ADD PRIMARY KEY ("user_id");
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_username_key" UNIQUE (username);
ALTER TABLE "user_roles" ADD PRIMARY KEY ("user_id");
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'moderator'::text, 'admin'::text])));
ALTER TABLE "watch_history" ADD PRIMARY KEY ("id");
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_uniq" UNIQUE (user_id, recording_id);
ALTER TABLE "watch_later_items" ADD PRIMARY KEY ("id");
ALTER TABLE "watch_later_items" ADD CONSTRAINT "watch_later_uniq" UNIQUE (user_id, recording_id);

-- Core indexes
CREATE INDEX IF NOT EXISTS "idx_ca_last_recorded" ON "channel_assignments" USING btree (last_recorded_at);
CREATE INDEX IF NOT EXISTS "idx_ca_assigned_node" ON "channel_assignments" USING btree (assigned_node);
CREATE INDEX IF NOT EXISTS "idx_ca_heartbeat" ON "channel_assignments" USING btree (last_heartbeat);
CREATE INDEX IF NOT EXISTS "idx_ca_islive" ON "channel_assignments" USING btree (is_live);
CREATE INDEX IF NOT EXISTS "idx_ca_status" ON "channel_assignments" USING btree (status);
CREATE INDEX IF NOT EXISTS "idx_channels_created_at" ON "channels" USING btree (created_at);
CREATE INDEX IF NOT EXISTS "idx_comment_likes_comment" ON "comment_likes" USING btree (comment_id);
CREATE INDEX IF NOT EXISTS "idx_comments_recording" ON "comments" USING btree (recording_id);
CREATE INDEX IF NOT EXISTS "idx_disk_usage_recorded_at" ON "disk_usage" USING btree (recorded_at DESC);
CREATE INDEX IF NOT EXISTS "idx_nodes_status" ON "nodes" USING btree (status);
CREATE INDEX IF NOT EXISTS "idx_nodes_session_deadline" ON "nodes" USING btree (session_deadline);
CREATE INDEX IF NOT EXISTS "idx_nodes_heartbeat" ON "nodes" USING btree (last_heartbeat);
CREATE INDEX IF NOT EXISTS "idx_performer_follows_user" ON "performer_follows" USING btree (user_id);
CREATE INDEX IF NOT EXISTS "idx_pool_autopilot_gender" ON "pool_autopilot" USING btree (gender);
CREATE INDEX IF NOT EXISTS "idx_preview_images_instance" ON "preview_images" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_preview_images_recording_id" ON "preview_images" USING btree (recording_id);
CREATE INDEX IF NOT EXISTS "idx_reactions_recording" ON "reactions" USING btree (recording_id);
CREATE INDEX IF NOT EXISTS "idx_recordings_channel_id" ON "recordings" USING btree (channel_id);
CREATE INDEX IF NOT EXISTS "idx_recordings_username" ON "recordings" USING btree (username);
CREATE INDEX IF NOT EXISTS "idx_recordings_gender" ON "recordings" USING btree (gender);
CREATE INDEX IF NOT EXISTS "idx_recordings_instance" ON "recordings" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_recordings_timestamp" ON "recordings" USING btree ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS "idx_requests_user" ON "requests" USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_requests_user_platform_performer" ON "requests" USING btree (user_id, platform, COALESCE(performer_username, ''::text), COALESCE(stream_link, ''::text));
CREATE INDEX IF NOT EXISTS "idx_saved_videos_user" ON "saved_videos" USING btree (user_id);
CREATE INDEX IF NOT EXISTS "idx_tunnels_run_id" ON "tunnels" USING btree (run_id);
CREATE INDEX IF NOT EXISTS "idx_tunnels_instance" ON "tunnels" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_tunnels_active" ON "tunnels" USING btree (is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS "idx_upload_journal_status" ON "upload_journal" USING btree (status);
CREATE INDEX IF NOT EXISTS "idx_upload_journal_hash" ON "upload_journal" USING btree (file_hash);
CREATE INDEX IF NOT EXISTS "idx_upload_links_host" ON "upload_links" USING btree (host);
CREATE INDEX IF NOT EXISTS "idx_upload_links_instance" ON "upload_links" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_upload_links_recording_id" ON "upload_links" USING btree (recording_id);
CREATE INDEX IF NOT EXISTS "idx_collection_items_collection" ON "user_collection_items" USING btree (collection_id);
CREATE INDEX IF NOT EXISTS "idx_collections_user" ON "user_collections" USING btree (user_id);
CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "user_notifications" USING btree (user_id);
CREATE INDEX IF NOT EXISTS "idx_notifications_unread" ON "user_notifications" USING btree (user_id, is_read);
CREATE INDEX IF NOT EXISTS "idx_watch_history_user" ON "watch_history" USING btree (user_id);
CREATE INDEX IF NOT EXISTS "idx_watch_later_user" ON "watch_later_items" USING btree (user_id);

-- Core RLS flags; old blanket allow-all policies are intentionally not copied
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comment_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disk_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performer_follows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pool_autopilot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preview_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recordings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_videos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tunnels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upload_journal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upload_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_collection_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_collections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "watch_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "watch_later_items" ENABLE ROW LEVEL SECURITY;

-- Views required by the RPC migrations
CREATE OR REPLACE VIEW public.recordings_with_links WITH (security_invoker = true) AS
SELECT r.id, r.channel_id, r.username, r.filename, r."timestamp", r.room_title,
       r.tags, r.viewers, r.resolution, r.framerate, r.filesize, r.duration,
       r.gender, r.thumbnail_url, r.sprite_url, r.embed_url, r.preview_url,
       r.sprite_vtt_url, r.instance_id, r.created_at, r.updated_at,
       NULLIF(jsonb_object_agg(ul.host, ul.url) FILTER (WHERE ul.host IS NOT NULL), '{}'::jsonb)::json AS links
FROM public.recordings r LEFT JOIN public.upload_links ul ON r.id = ul.recording_id
GROUP BY r.id;

CREATE OR REPLACE VIEW public.channel_statistics WITH (security_invoker = true) AS
SELECT c.username, c.is_paused, count(r.id) AS total_recordings,
       sum(r.filesize) AS total_filesize_bytes, max(r."timestamp") AS last_recording_at,
       avg(r.viewers) AS avg_viewers, c.created_at, c.updated_at
FROM public.channels c LEFT JOIN public.recordings r ON c.username::text = r.username::text
GROUP BY c.id, c.username, c.is_paused, c.created_at, c.updated_at;


-- ============================================================
-- supabase/migrations/001_aggregate_rpcs.sql
-- ============================================================
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



-- ============================================================
-- supabase/migrations/003-watch-history-progress.sql
-- ============================================================
-- Add progress tracking to watch_history
-- progress: 0-100 (percentage watched)
-- last_position_ms: resume position in milliseconds
-- total_watch_ms: total time spent watching this recording
ALTER TABLE watch_history
  ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  ADD COLUMN IF NOT EXISTS last_position_ms bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_watch_ms bigint DEFAULT 0;

-- Index for "continue watching" query (unfinished videos, sorted by most recent)
CREATE INDEX IF NOT EXISTS idx_watch_history_continue
  ON watch_history (user_id, watched_at DESC)
  WHERE progress < 100;

-- Index for stats queries
CREATE INDEX IF NOT EXISTS idx_watch_history_stats
  ON watch_history (user_id, progress, total_watch_ms);



-- ============================================================
-- supabase/migrations/004-edge-cache.sql
-- ============================================================
-- Shared cross-device edge cache for the frontend's Tier-0 cache layer
-- (artifacts/video-archive/src/lib/cache.ts). The browser writes API payloads
-- here keyed by query key with a TTL, so repeat visits on any device can hit
-- the edge instead of the API server. Only the `cache` edge function touches
-- this table (via the service-role key); anonymous users never see it.
CREATE TABLE IF NOT EXISTS public.edge_cache (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  expires_at timestamptz           -- NULL = never expires
);

CREATE INDEX IF NOT EXISTS edge_cache_expires_at_idx
  ON public.edge_cache (expires_at);

-- Locked down: no RLS policies, so only the service role (the edge function)
-- can read or write it.
ALTER TABLE public.edge_cache ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- supabase/migrations/005-premium.sql
-- ============================================================
-- Premium / ad-free access + ad-earn tracking.
--
-- Tables:
--   user_premium        — per-user premium expiry + daily ad-earn progress
--   premium_purchases   — idempotent record of completed purchases (webhook-safe)
--   site_settings       — runtime config overrides (ads kill-switch, earn target,
--                         cooldown, grace window, price) readable without a redeploy
--
-- Functions:
--   claim_premium_reward — atomic "watch an ad -> progress toward premium" claim.
--     SQL-level transaction + row lock prevents double-claims at the midnight
--     boundary or from concurrent requests.

CREATE TABLE IF NOT EXISTS user_premium (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  premium_expires_at timestamptz,
  ads_seen_date     date,
  ads_seen_count    integer NOT NULL DEFAULT 0,
  last_rewarded_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_premium_expiry
  ON user_premium (premium_expires_at);

CREATE TABLE IF NOT EXISTS premium_purchases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  provider_session_id  text UNIQUE,
  amount               numeric(10,2),
  currency             text,
  days                 integer NOT NULL DEFAULT 30,
  purchased_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_premium_purchases_user
  ON premium_purchases (user_id);

CREATE TABLE IF NOT EXISTS site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_settings (key, value) VALUES
  ('ads_enabled',        'true'::jsonb),
  ('ads_target',         '5'::jsonb),
  ('reward_cooldown_s',  '60'::jsonb),
  ('grace_minutes',      '10'::jsonb),
  ('price_usd',          '4.99'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─── Row Level Security ────────────────────────────────────────────────────
-- Users may read their own premium/premium_purchases rows. site_settings is
-- public-read (server still gates writes via the service-role key). All
-- authenticated API writes go through the service-role client (bypasses RLS),
-- matching the existing role/auth endpoints.

ALTER TABLE user_premium ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_premium_owner_select ON user_premium;
CREATE POLICY user_premium_owner_select ON user_premium
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS premium_purchases_owner_select ON premium_purchases;
CREATE POLICY premium_purchases_owner_select ON premium_purchases
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS site_settings_read ON site_settings;
CREATE POLICY site_settings_read ON site_settings
  FOR SELECT USING (true);

-- ─── Atomic reward claim ───────────────────────────────────────────────────
-- p_cooldown_s: minimum seconds between claims (0 disables the cap)
-- p_target:     ads seen after which premium is granted (+1 day, extends expiry)

CREATE OR REPLACE FUNCTION claim_premium_reward(
  p_user_id    uuid,
  p_cooldown_s integer,
  p_target     integer
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row         user_premium;
  v_now         timestamptz := now();
  v_today       date        := current_date;
  v_granted     boolean     := false;
  v_cooldown_ms integer     := 0;
BEGIN
  -- Ensure a row exists so SELECT ... FOR UPDATE has something to lock.
  INSERT INTO user_premium (user_id, created_at, updated_at)
  VALUES (p_user_id, v_now, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row
  FROM user_premium
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Cooldown gate (rejects early unless it's already expired).
  IF v_row.last_rewarded_at IS NOT NULL AND p_cooldown_s > 0 THEN
    v_cooldown_ms := GREATEST(
      0,
      p_cooldown_s * 1000 - (EXTRACT(EPOCH FROM (v_now - v_row.last_rewarded_at))::integer) * 1000
    );
    IF v_cooldown_ms > 0 THEN
      RETURN jsonb_build_object(
        'granted',         false,
        'cooldown_ms',     v_cooldown_ms,
        'ads_viewed_today', v_row.ads_seen_count,
        'ads_target',      p_target,
        'premium_until',   v_row.premium_expires_at,
        'is_premium',      v_row.premium_expires_at > v_now
      );
    END IF;
  END IF;

  -- Roll the daily window when the date changes.
  IF v_row.ads_seen_date IS DISTINCT FROM v_today THEN
    v_row.ads_seen_date  := v_today;
    v_row.ads_seen_count := 0;
  END IF;

  v_row.ads_seen_count  := v_row.ads_seen_count + 1;
  v_row.last_rewarded_at := v_now;

  -- Grant: extend from the later of "now" and the existing expiry so stacking
  -- never shortens a current subscription, then reset the daily counter.
  IF p_target > 0 AND v_row.ads_seen_count >= p_target THEN
    v_row.premium_expires_at := GREATEST(v_now, COALESCE(v_row.premium_expires_at, v_now)) + interval '1 day';
    v_row.ads_seen_count     := 0;
    v_granted                := true;
  END IF;

  UPDATE user_premium
  SET premium_expires_at = v_row.premium_expires_at,
      ads_seen_date      = v_row.ads_seen_date,
      ads_seen_count     = v_row.ads_seen_count,
      last_rewarded_at   = v_row.last_rewarded_at,
      updated_at         = v_now
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'granted',          v_granted,
    'cooldown_ms',      v_cooldown_ms,
    'ads_viewed_today', v_row.ads_seen_count,
    'ads_target',       p_target,
    'premium_until',    v_row.premium_expires_at,
    'is_premium',       v_row.premium_expires_at > v_now
  );
END;
$$;


-- ============================================================
-- supabase/migrations/006-security-day.sql
-- ============================================================
-- 006: security hardening day
--
-- Changes:
-- 1. Daily reward cap: claim_premium_reward now only grants once per calendar
--    day (last_granted_date). Grinding past 5 ads on a day won't produce a
--    second +1 day, eliminating the unlimited-farming vector.
-- 2. Atomic view count: increment_viewer_count() replaces the read-modify-write
--    loop with a single UPDATE … RETURNING, eliminating lost increments from
--    concurrent requests.

-- ─── 1. Daily reward cap ─────────────────────────────────────────────────────

ALTER TABLE user_premium ADD COLUMN IF NOT EXISTS last_granted_date date;

CREATE OR REPLACE FUNCTION claim_premium_reward(
  p_user_id    uuid,
  p_cooldown_s integer,
  p_target     integer
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row         user_premium;
  v_now         timestamptz := now();
  v_today       date        := current_date;
  v_granted     boolean     := false;
  v_cooldown_ms integer     := 0;
BEGIN
  -- Ensure a row exists so SELECT ... FOR UPDATE has something to lock.
  INSERT INTO user_premium (user_id, created_at, updated_at)
  VALUES (p_user_id, v_now, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row
  FROM user_premium
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Cooldown gate (rejects early unless it's already expired).
  IF v_row.last_rewarded_at IS NOT NULL AND p_cooldown_s > 0 THEN
    v_cooldown_ms := GREATEST(
      0,
      p_cooldown_s * 1000 - (EXTRACT(EPOCH FROM (v_now - v_row.last_rewarded_at))::integer) * 1000
    );
    IF v_cooldown_ms > 0 THEN
      RETURN jsonb_build_object(
        'granted',             false,
        'cooldown_ms',         v_cooldown_ms,
        'already_granted_today', false,
        'ads_viewed_today',    v_row.ads_seen_count,
        'ads_target',          p_target,
        'premium_until',       v_row.premium_expires_at,
        'is_premium',          v_row.premium_expires_at > v_now
      );
    END IF;
  END IF;

  -- Roll the daily window when the date changes.
  IF v_row.ads_seen_date IS DISTINCT FROM v_today THEN
    v_row.ads_seen_date      := v_today;
    v_row.ads_seen_count     := 0;
    v_row.last_granted_date  := NULL;
  END IF;

  -- DAILY GRANT CAP: if the user already received a reward today, refuse.
  IF v_row.last_granted_date = v_today THEN
    RETURN jsonb_build_object(
      'granted',             false,
      'cooldown_ms',         0,
      'already_granted_today', true,
      'ads_viewed_today',    v_row.ads_seen_count,
      'ads_target',          p_target,
      'premium_until',       v_row.premium_expires_at,
      'is_premium',          v_row.premium_expires_at > v_now
    );
  END IF;

  v_row.ads_seen_count  := v_row.ads_seen_count + 1;
  v_row.last_rewarded_at := v_now;

  -- Grant: extend from the later of "now" and the existing expiry so stacking
  -- never shortens a current subscription, then reset the daily counter.
  IF p_target > 0 AND v_row.ads_seen_count >= p_target THEN
    v_row.premium_expires_at := GREATEST(v_now, COALESCE(v_row.premium_expires_at, v_now)) + interval '1 day';
    v_row.ads_seen_count     := 0;
    v_row.last_granted_date  := v_today;
    v_granted                := true;
  END IF;

  UPDATE user_premium
  SET premium_expires_at = v_row.premium_expires_at,
      ads_seen_date      = v_row.ads_seen_date,
      ads_seen_count     = v_row.ads_seen_count,
      last_rewarded_at   = v_row.last_rewarded_at,
      last_granted_date  = v_row.last_granted_date,
      updated_at         = v_now
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'granted',             v_granted,
    'cooldown_ms',         v_cooldown_ms,
    'already_granted_today', false,
    'ads_viewed_today',    v_row.ads_seen_count,
    'ads_target',          p_target,
    'premium_until',       v_row.premium_expires_at,
    'is_premium',          v_row.premium_expires_at > v_now
  );
END;
$$;

-- ─── 2. Atomic view count ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_viewer_count(p_recording_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.recordings
  SET viewers = COALESCE(viewers, 0) + 1
  WHERE id = p_recording_id
  RETURNING COALESCE(viewers, 0)::bigint;
$$;



-- ============================================================
-- supabase/migrations/007-performer-follows.sql
-- ============================================================
-- Performer follows: lets a signed-in user follow a performer and see the
-- list of performers they follow (used by /api/user/follows).
--
-- The table was used by the API but never migrated 2026-09 — this adds it
-- idempotently so GET/POST/DELETE /user/follows stop returning 500s.

-- 0. Drop every existing policy on the table. A stale policy (even one with a
--    different name) blocks ALTER COLUMN ... TYPE with
--    "cannot alter type of a column used in a policy definition".
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname
             FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'performer_follows'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.performer_follows', pol.policyname);
  END LOOP;
END $$;

-- 1. Make sure the table exists.
CREATE TABLE IF NOT EXISTS public.performer_follows (
  user_id            uuid NOT NULL,
  performer_username text NOT NULL,
  followed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, performer_username)
);

-- 2. Normalize a pre-existing table that stored user_id as text instead of
--    uuid. Without this, `auth.uid() = user_id` fails with
--    "operator does not exist: uuid = text". Casting NULLs is a no-op, so an
--    untouched/empty table converts cleanly.
ALTER TABLE public.performer_follows
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- 3. Guarantee the (user_id, performer_username) unique target relied on by
--    the route's `upsert(..., onConflict [onConflict: "user_id, performer_username"])`.
CREATE UNIQUE INDEX IF NOT EXISTS performer_follows_user_performer_key
  ON public.performer_follows (user_id, performer_username);

-- 4. FK to auth.users (added conditionally in case the pre-existing table
--    predates it). Rebuilds automatically with ALTER COLUMN ... TYPE above if
--    the PK covered user_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'performer_follows_user_id_fkey'
      AND conrelid = 'public.performer_follows'::regclass
  ) THEN
    ALTER TABLE public.performer_follows
      ADD CONSTRAINT performer_follows_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 5. Ordering query: follows for a user sorted by most recent first.
CREATE INDEX IF NOT EXISTS idx_performer_follows_user_followed
  ON public.performer_follows (user_id, followed_at DESC);

-- ─── Row Level Security ────────────────────────────────────────────────────
-- Users may manage (select/insert/update/delete) only their own follows.
-- The API's user-scoped client (createUserClient) hits these; the
-- service-role client used by recordings.ts / admin.ts bypasses RLS.
ALTER TABLE public.performer_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS performer_follows_owner_all ON performer_follows;
CREATE POLICY performer_follows_owner_all ON public.performer_follows
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- supabase/migrations/008-notifications.sql
-- ============================================================
-- 008: notifications hardening
--
-- Ensures the two notification tables exist with the columns the API and the
-- notify_requesters_on_upload trigger rely on, adds a read-optimized index,
-- locks RLS to owner-only access, and registers user_notifications with the
-- supabase_realtime publication so the bell updates instantly.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
--
-- NOTE: user_id is kept as `text` (matching the legacy bootstrap used by the
-- rest of the user-data tables and the notify_requesters_on_upload trigger,
-- which reads user_id straight out of `requests`). RLS compares via
-- auth.uid()::text so it type-checks regardless of the stored type.

-- ─── user_notifications ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    text NOT NULL,
  type       text NOT NULL,
  message    text NOT NULL,
  related_id text,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fill in columns that may be missing on older/bootstrapped installs.
ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'request_status',
  ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS related_id text,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Read pattern: per-user list ordered newest-first (used by GET /notifications).
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON public.user_notifications (user_id, created_at DESC);

-- ─── user_notification_preferences ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id           text NOT NULL,
  notification_type text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  email_enabled     boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_type)
);

ALTER TABLE public.user_notification_preferences
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─── Row Level Security ────────────────────────────────────────────────────
-- Users may read/manage only their own notification rows. Server-side
-- insert/delete paths run through the service-role client (bypasses RLS) and
-- the notify_requesters_on_upload trigger is SECURITY DEFINER, so those are
-- unaffected.

-- Drop any stale policies (possibly bootstrapped ad-hoc) so the owner
-- policies below are the only ones in effect.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname
             FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'user_notifications'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_notifications', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname
             FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'user_notification_preferences'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_notification_preferences', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notifications_owner_all ON user_notifications;
CREATE POLICY user_notifications_owner_all ON public.user_notifications
  FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS user_notification_preferences_owner_all ON user_notification_preferences;
CREATE POLICY user_notification_preferences_owner_all ON public.user_notification_preferences
  FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- ─── Realtime ──────────────────────────────────────────────────────────────
-- Register with Supabase Realtime so the client's postgres_changes
-- subscription (use-realtime-notifications) stops warning about a missing
-- source. No-op if the publication doesn't exist or already includes it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'user_notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;


-- ============================================================
-- supabase/migrations/009-unique-user-recording-constraints.sql
-- ============================================================
-- Add unique constraints to watch_history and saved_videos so onConflict upsert works
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.watch_history'::regclass 
      AND conname = 'watch_history_user_recording_unique'
  ) THEN
    ALTER TABLE public.watch_history 
      ADD CONSTRAINT watch_history_user_recording_unique UNIQUE (user_id, recording_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.saved_videos'::regclass 
      AND conname = 'saved_videos_user_recording_unique'
  ) THEN
    ALTER TABLE public.saved_videos 
      ADD CONSTRAINT saved_videos_user_recording_unique UNIQUE (user_id, recording_id);
  END IF;
END $$;


-- ============================================================
-- supabase/migrations/010-unique-watch-later-follows-constraints.sql
-- ============================================================
-- Migration 010: Add unique constraints for upsert support on watch_later_items and performer_follows
-- Applied: 2026-09-23

-- Allow upsert with onConflict: "user_id, recording_id" in watch_later_items
ALTER TABLE public.watch_later_items
  ADD CONSTRAINT watch_later_items_user_recording_unique
  UNIQUE (user_id, recording_id);

-- Allow upsert with onConflict: "user_id, performer_username" in performer_follows
ALTER TABLE public.performer_follows
  ADD CONSTRAINT performer_follows_user_performer_unique
  UNIQUE (user_id, performer_username);



-- ============================================================
-- supabase/migrations/011-ads.sql
-- ============================================================
--011: admin-managed ad creatives (ad_creatives)
--
-- Moves ad content out of the git-tracked ads/*.txt files into Supabase:
-- the Admin -> Ads panel CRUDs rows here, and every open page picks edits
-- up in REALTIME (postgres_changes subscription in AdsContext). The
-- ads/*.txt files remain as the build-time FALLBACK for when this table
-- is unreachable (migration not run, network failure) — once this table
-- exists it is AUTHORITATIVE, including for empty slots.
--
-- RLS: public read (ads are public content); no anon writes — admin CRUD
-- only happens through the API server's service-role client behind
-- requireRole('admin'). Idempotent — safe to re-run in the SQL Editor.

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot       text NOT NULL,                 -- slot name, e.g. 'medium-rect-300x250'
  kind       text NOT NULL DEFAULT 'html' CHECK (kind IN ('html', 'url')),
  content    text NOT NULL,                 -- HTML/JS code, or a bare image/smartlink URL
  enabled    boolean NOT NULL DEFAULT true, -- disabled rows stay but never render
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fill in columns that may be missing on older/bootstrapped installs.
ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Read pattern: the site and the admin panel both list per slot.
CREATE INDEX IF NOT EXISTS idx_ad_creatives_slot ON public.ad_creatives (slot);

-- ─── Row Level Security ──────────────────────────────────────────────────
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_creatives_public_read ON public.ad_creatives;
CREATE POLICY ad_creatives_public_read ON public.ad_creatives
  FOR SELECT
  USING (true);
-- No INSERT/UPDATE/DELETE policies: the anon key can never write ads.
-- Admin writes use the service-role client (bypasses RLS) in
-- artifacts/api-server/src/routes/admin-ads.ts.

-- ─── Realtime ────────────────────────────────────────────────────────────
-- Register with Supabase Realtime so AdsContext's postgres_changes
-- subscription delivers live ad edits to every open page. No-op when the
-- publication doesn't exist or already includes the table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'ad_creatives'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_creatives;
  END IF;
END $$;

-- ─── Seed (first run only) ───────────────────────────────────────────────
-- Import the creatives already living in ads/*.txt so the site shows
-- exactly what it showed before this migration. Skipped as soon as any
-- row exists, so re-running never resurrects deleted ads.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ad_creatives LIMIT 1) THEN RETURN; END IF;
  INSERT INTO public.ad_creatives (slot, kind, content) VALUES
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_300250_sara_fun_en.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_25_300250_en_1.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_1_300250_en_4.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_5_300250_en_9.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_26_300250_en_2.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_232_300250_du_3.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/3778/stripchat_234_300250_du_1.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8780/JM-379_DESIGN-20352_VixenMinx-BoobsGif_300250.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8780/JM-645_DESIGN-22633_BANN5_RANDOMHOTTIES_DAINTYWILDER_TXT_300250.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006611AX_FCAM_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006664M_FCAM_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/003672AU_MYFC_18_ALL_EN_71_E.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006611V_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006654A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/20180815140636-006605A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006271A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005250A_MYFC_18_ALL_EN_71_N.jpg'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005449B_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/006611U_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005449B_MYFC_18_ALL_DE_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/005438A_MYFC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/779/003496H_MYFC_18_ALL_EN_71_N.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/9945/Cam4_Naughty-Girls_EN_300250_02.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/9945/Cam4_Naughty-Girls_EN_300250_01.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/005973D_LIFF_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/006491C_LIFF_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000012I_EXWC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000012J_EXWC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000081A_EXWC_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/235/000156A_SLUT_18_ALL_EN_71_E.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/2676/LiveJasmin_Horny-Estee_EN_3002500_05.jpg'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/2676/001753A_LIJA_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8135/011630A_ROYA_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8135/011632A_ROYA_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/8135/B1-300x250.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/008565A_SLUT_18_ALL_EN_71_L.jpg'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/010726G_SLUT_18_ALL_EN_71_L.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/005199G_SLUT_18_ALL_ES_71_E.gif'),
    ('medium-rect-300x250', 'url', 'https://www.imglnky.com/153/010726G_SLUT_18_ALL_EN_71_L.gif');
END $$;



-- ============================================================
-- supabase/migrations/012-ad-settings.sql
-- ============================================================
-- 012: ad placement controls (ad_settings) + creative ordering
--
-- Gives Admin → Ads a real control system:
--   * `ad_creatives.sort_order` — explicit rotation order (move up/down).
--   * `ad_settings` — a singleton jsonb config row controlling WHERE ads
--     render: per-page switches, per-zone switches (strips/in-feed/boxes/
--     in-card/popunder/reward CTA), the in-card layer (max per page + which
--     slot feeds it) and the rotation interval. Publicly readable (the site
--     needs it anonymously); writes only via the API server's service-role
--     client behind requireRole('admin'). Realtime-registered so open pages
--     pick up changes instantly.
-- Idempotent — safe to re-run in the Supabase SQL Editor.

ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- Backfill rotation order by creation time — first run only (guarded so a
-- re-run never clobbers orders an admin has set since).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ad_creatives)
     AND NOT EXISTS (SELECT 1 FROM public.ad_creatives WHERE sort_order <> 0) THEN
    UPDATE public.ad_creatives c
    SET sort_order = t.rn - 1
    FROM (
      SELECT id, row_number() OVER (PARTITION BY slot ORDER BY created_at, id) AS rn
      FROM public.ad_creatives
    ) t
    WHERE c.id = t.id;
  END IF;
END $$;

-- ─── ad_settings (singleton row, id = 1) ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ad_settings (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_settings_public_read ON public.ad_settings;
CREATE POLICY ad_settings_public_read ON public.ad_settings
  FOR SELECT
  USING (true);
-- No write policies: anon can read config but never change it.

-- Realtime so placement edits reach every open page instantly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'ad_settings'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_settings;
  END IF;
END $$;

-- Singleton row (config stays '{}' until the admin panel saves — every
-- missing key reads as "ads on" / current defaults).
INSERT INTO public.ad_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;



-- ============================================================
-- supabase/migrations/013-collection-item-position.sql
-- ============================================================
-- 013-collection-item-position.sql — stable ordering for collection items.
--
-- Until now user_collection_items had no explicit order: items were shown by
-- added_at DESC (newest first) and "Play all" played that implicit order.
-- Playlists (the Spotify/YouTube model) need a user-controlled order that
-- survives add/remove, so items get a `position` integer (0-based, dense).
--
-- Schema reality (verified via pg_catalog before writing this): ids and
-- user_id are TEXT, user_collection_items.id is an integer, and RLS is
-- already enforced by the existing uci_*_own policies — including
-- uci_update_own, which this migration relies on for direct updates.
--
-- Rules kept simple and race-tolerant:
--   - new items append after the current max (min + count, safe even if
--     historical gaps leave max not dense)
--   - reorder renumbers the whole collection in one RPC call (atomic, and
--     the client never sends per-row updates)

-- ── 1. Column ────────────────────────────────────────────────────────────
alter table public.user_collection_items
  add column if not exists position integer;

-- ── 2. Backfill: order by added_at, then id (deterministic tiebreak) ────
with ranked as (
  select id, row_number() over (
           partition by collection_id
           order by added_at asc, id asc
         ) - 1 as pos
  from public.user_collection_items
)
update public.user_collection_items u
set position = ranked.pos
from ranked
where u.id = ranked.id
  and (u.position is distinct from ranked.pos);

-- ── 3. Append-on-insert trigger ──────────────────────────────────────────
create or replace function public.user_collection_items_set_position()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base integer;
begin
  select coalesce(min(position), 0) + count(*)::int
    into base
  from public.user_collection_items
  where collection_id = new.collection_id;
  new.position := base;
  return new;
end;
$$;

drop trigger if exists trg_collection_item_position
  on public.user_collection_items;
create trigger trg_collection_item_position
  before insert on public.user_collection_items
  for each row execute function public.user_collection_items_set_position();

-- ── 4. Reorder RPC (atomic whole-collection renumber) ───────────────────
-- One statement = one snapshot: N per-row updates from the API would be
-- non-atomic over PostgREST (interleaved reads would see torn orders).
-- Rows missing from the payload keep their position (partial reorders OK);
-- the normal client sends every id, so renumbering is dense.
create or replace function public.reorder_collection_items(
  p_collection_id text,
  p_recording_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text;
  v_caller text;
  v_updated integer := 0;
  rec record;
begin
  v_caller := (auth.uid())::text;
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select user_id into v_user
  from public.user_collections
  where id = p_collection_id;
  if v_user is null then
    raise exception 'collection not found';
  end if;
  if v_user <> v_caller then
    raise exception 'not permitted';
  end if;

  if p_recording_ids is null or cardinality(p_recording_ids) = 0 then
    raise exception 'recording_ids required';
  end if;

  -- Duplicate ids would make the renumber ambiguous — reject loudly.
  if exists (
    select 1 from unnest(p_recording_ids) x
    group by x
    having count(*) > 1
  ) then
    raise exception 'duplicate recording ids in payload';
  end if;

  -- Renumber the payload rows by their array index (0-based).
  for rec in
    select i, x from unnest(p_recording_ids) with ordinality as t(x, i)
  loop
    update public.user_collection_items
       set position = rec.i - 1
     where collection_id = p_collection_id
       and recording_id = rec.x;
    v_updated := v_updated + 1;
  end loop;

  -- Keep metadata fresh for the collections list view.
  update public.user_collections
     set updated_at = now()
   where id = p_collection_id;

  return v_updated;
end;
$$;

grant execute on function public.reorder_collection_items(text, text[]) to authenticated;



-- ============================================================
-- supabase/migrations/014-unique-collection-items.sql
-- ============================================================
-- Ensure collection-item upserts can infer the (collection_id, recording_id) conflict target.
-- Keep the earliest row for any historical duplicate pair before enforcing uniqueness.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY collection_id, recording_id
      ORDER BY added_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.user_collection_items
)
DELETE FROM public.user_collection_items AS items
USING ranked
WHERE items.ctid = ranked.ctid
  AND ranked.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_collection_items'::regclass
      AND conname = 'user_collection_items_collection_recording_unique'
  ) THEN
    ALTER TABLE public.user_collection_items
      ADD CONSTRAINT user_collection_items_collection_recording_unique
      UNIQUE (collection_id, recording_id);
  END IF;
END $$;



-- ============================================================
-- supabase/migrations/015-optimized-aggregate-rpcs.sql
-- ============================================================
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



-- ============================================================
-- supabase/migrations/016-performer-aggregate-rpc.sql
-- ============================================================
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



-- ============================================================
-- supabase/migrations/017-search-performance-indexes.sql
-- ============================================================
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



-- ============================================================
-- supabase/migrations/018-restore-recordings-with-links-view.sql
-- ============================================================
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



-- ============================================================
-- supabase/migrations/019-enable-rls.sql
-- ============================================================
-- Enable row-level security on application tables.
-- Public recording metadata and upload links are intentionally readable;
-- user-scoped tables are restricted to rows owned by auth.uid().
-- Tables without an explicit safe policy remain default-deny for API roles.
BEGIN;

DO $$
DECLARE
  t record;
  has_user_id boolean;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('spatial_ref_sys')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);

    -- Idempotently allow public read-only access to the recording catalogue.
    IF t.relname IN ('recordings', 'upload_links') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        'public_read_' || t.relname, t.relname);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
        'public_read_' || t.relname, t.relname
      );
    END IF;

    -- Standard owner policy for user-scoped tables. Never grant ownership
    -- based on client-supplied claims other than the verified auth.uid().
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t.relname
        AND column_name = 'user_id'
    ) INTO has_user_id;

    IF has_user_id THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        'user_owns_rows', t.relname);
      EXECUTE format(
        'CREATE POLICY user_owns_rows ON public.%I FOR ALL TO authenticated USING (user_id::text = (SELECT auth.uid())::text) WITH CHECK (user_id::text = (SELECT auth.uid())::text)',
        t.relname
      );
    END IF;
  END LOOP;
END
$$;

-- Make sure the API roles can read the intended public catalogue; RLS still
-- applies to these grants and writes remain service-role-only unless separately
-- granted by a deliberate policy.
DO $$
BEGIN
  IF to_regclass('public.recordings') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.recordings TO anon, authenticated;
  END IF;
  IF to_regclass('public.upload_links') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.upload_links TO anon, authenticated;
  END IF;
END
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';



-- ============================================================
-- supabase/migrations/020-fast-linked-recordings-and-hot-path-indexes.sql
-- ============================================================
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
  link_data.link_map::json AS links
FROM public.recordings AS r
JOIN LATERAL (
  SELECT jsonb_object_agg(ul.host, ul.url) AS link_map
  FROM public.upload_links AS ul
  WHERE ul.recording_id = r.id
    AND ul.host IS NOT NULL
) AS link_data ON link_data.link_map IS NOT NULL;

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

-- The application may encounter older deployments where user_id was uuid
-- rather than text. The expression index and text comparison below support
-- either representation without uuid = text operator errors.
CREATE INDEX IF NOT EXISTS watch_history_user_text_watched_at_desc_idx
  ON public.watch_history ((user_id::text), watched_at DESC);

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

CREATE INDEX IF NOT EXISTS reactions_recording_type_idx
  ON public.reactions (recording_id, type);

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

-- Aggregate interaction reads in Postgres instead of returning every like
-- row to a serverless function. Both functions preserve the existing API result
-- shapes and have fallback implementations in the application code.

CREATE OR REPLACE FUNCTION public.get_reaction_counts(p_recording_id text)
RETURNS TABLE (likes bigint, dislikes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    count(*) FILTER (WHERE r.type = 'like')::bigint AS likes,
    count(*) FILTER (WHERE r.type = 'dislike')::bigint AS dislikes
  FROM public.reactions AS r
  WHERE r.recording_id = p_recording_id;
$$;

REVOKE ALL ON FUNCTION public.get_reaction_counts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reaction_counts(text) TO anon, authenticated, service_role;

-- Safe parsing preserves the old API's "skip malformed metadata" behavior
-- while allowing watch-history statistics to aggregate entirely in Postgres.
CREATE OR REPLACE FUNCTION public.try_parse_jsonb(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.try_parse_jsonb(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_parse_jsonb(text) TO authenticated, service_role;

-- One result row for all watch-history stats, avoiding an unbounded transfer to
-- the serverless API. RLS remains in force because this is SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.get_user_history_stats(p_user_id text)
RETURNS TABLE (
  total_watch_ms double precision,
  total_videos bigint,
  completed_videos bigint,
  avg_progress integer,
  top_performers jsonb,
  day_buckets jsonb,
  hour_buckets jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH user_items AS MATERIALIZED (
    SELECT
      coalesce(h.progress, 0) AS progress,
      coalesce(h.total_watch_ms, 0)::double precision AS watch_ms,
      public.try_parse_jsonb(h.metadata::text) AS metadata_json,
      h.watched_at
    FROM public.watch_history AS h
    WHERE h.user_id::text = p_user_id::text
  ),
  summary AS (
    SELECT
      coalesce(sum(watch_ms), 0)::double precision AS total_watch_ms,
      count(*)::bigint AS total_videos,
      count(*) FILTER (WHERE progress >= 100)::bigint AS completed_videos,
      coalesce(round(avg(progress)), 0)::integer AS avg_progress
    FROM user_items
  ),
  performer_stats AS (
    SELECT
      coalesce(metadata_json ->> 'username', 'unknown') AS username,
      count(*)::bigint AS video_count,
      coalesce(sum(watch_ms), 0)::double precision AS watch_ms
    FROM user_items
    GROUP BY coalesce(metadata_json ->> 'username', 'unknown')
    ORDER BY video_count DESC, username ASC
    LIMIT 10
  ),
  day_stats AS (
    SELECT
      extract(dow FROM watched_at AT TIME ZONE 'UTC')::integer AS bucket,
      sum(watch_ms)::double precision AS watch_ms
    FROM user_items
    WHERE watched_at >= now() - interval '30 days'
    GROUP BY 1
  ),
  hour_stats AS (
    SELECT
      extract(hour FROM watched_at AT TIME ZONE 'UTC')::integer AS bucket,
      sum(watch_ms)::double precision AS watch_ms
    FROM user_items
    WHERE watched_at >= now() - interval '30 days'
    GROUP BY 1
  )
  SELECT
    s.total_watch_ms,
    s.total_videos,
    s.completed_videos,
    s.avg_progress,
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'username', p.username,
        'count', p.video_count,
        'watchMs', p.watch_ms
      ) ORDER BY p.video_count DESC, p.username ASC) FROM performer_stats AS p),
      '[]'::jsonb
    ) AS top_performers,
    (SELECT jsonb_agg(coalesce(d.watch_ms, 0) ORDER BY days.n)
     FROM generate_series(0, 6) AS days(n)
     LEFT JOIN day_stats AS d ON d.bucket = days.n) AS day_buckets,
    (SELECT jsonb_agg(coalesce(h.watch_ms, 0) ORDER BY hours.n)
     FROM generate_series(0, 23) AS hours(n)
     LEFT JOIN hour_stats AS h ON h.bucket = hours.n) AS hour_buckets
  FROM summary AS s;
$$;

REVOKE ALL ON FUNCTION public.get_user_history_stats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_history_stats(text) TO authenticated, service_role;

-- Return a sorted comment page, like counts, caller-session state and total
-- in one round trip. Pagination happens in Postgres so a request for page 1
-- does not transfer every comment and every like into the serverless function.
CREATE OR REPLACE FUNCTION public.get_comment_feed(
  p_recording_id text,
  p_sort text DEFAULT 'new',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT NULL,
  p_session_id text DEFAULT NULL
)
RETURNS TABLE (
  id integer,
  recording_id text,
  parent_id integer,
  author text,
  content text,
  deleted boolean,
  created_at timestamptz,
  likes bigint,
  user_liked boolean,
  total bigint
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH target_comments AS MATERIALIZED (
    SELECT
      c.id,
      c.recording_id,
      c.parent_id,
      c.author,
      c.content,
      c.deleted,
      c.created_at
    FROM public.comments AS c
    WHERE c.recording_id = p_recording_id
  ),
  comment_totals AS (
    SELECT count(*)::bigint AS total
    FROM target_comments
  ),
  comment_likes AS (
    SELECT
      cl.comment_id,
      count(*)::bigint AS like_count,
      coalesce(bool_or(cl.session_id = p_session_id), false) AS user_liked
    FROM public.comment_likes AS cl
    JOIN target_comments AS tc ON tc.id = cl.comment_id
    GROUP BY cl.comment_id
  ),
  ranked AS (
    SELECT
      tc.*,
      coalesce(cl.like_count, 0)::bigint AS likes,
      coalesce(cl.user_liked, false) AS user_liked,
      totals.total
    FROM target_comments AS tc
    CROSS JOIN comment_totals AS totals
    LEFT JOIN comment_likes AS cl ON cl.comment_id = tc.id
  )
  SELECT
    ranked.id,
    ranked.recording_id,
    ranked.parent_id,
    ranked.author,
    ranked.content,
    ranked.deleted,
    ranked.created_at,
    ranked.likes,
    ranked.user_liked,
    ranked.total
  FROM ranked
  ORDER BY
    (ranked.parent_id IS NOT NULL) ASC,
    CASE WHEN p_sort = 'top' THEN ranked.likes END DESC NULLS LAST,
    CASE WHEN p_sort = 'old' THEN ranked.created_at END ASC NULLS LAST,
    CASE WHEN p_sort IS DISTINCT FROM 'old' THEN ranked.created_at END DESC NULLS LAST,
    ranked.id ASC
  OFFSET greatest(coalesce(p_offset, 0), 0)
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_comment_feed(text, text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comment_feed(text, text, integer, integer, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_comment_like_stats(
  p_comment_ids integer[],
  p_session_id text DEFAULT NULL
)
RETURNS TABLE (comment_id integer, like_count bigint, user_liked boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    requested.comment_id,
    count(cl.comment_id)::bigint AS like_count,
    coalesce(bool_or(cl.session_id = p_session_id), false) AS user_liked
  FROM unnest(coalesce(p_comment_ids, ARRAY[]::integer[])) AS requested(comment_id)
  LEFT JOIN public.comment_likes AS cl
    ON cl.comment_id = requested.comment_id
  GROUP BY requested.comment_id;
$$;

REVOKE ALL ON FUNCTION public.get_comment_like_stats(integer[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comment_like_stats(integer[], text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';


-- Core update timestamps and recording-availability notifications
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_user_channels_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

-- ── Function: Notify users when a new upload link makes a recording available ──
CREATE OR REPLACE FUNCTION public.notify_requesters_on_upload()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_username text;
BEGIN
  -- Get the performer username from the associated recording
  SELECT r.username INTO v_username
  FROM public.recordings r
  WHERE r.id = NEW.recording_id;

  -- Skip if recording not found or no username
  IF v_username IS NULL THEN
    RETURN NEW;
  END IF;

  -- Notify all users with pending or approved requests for this performer,
  -- but only if they haven't disabled 'recording_available' notifications.
  -- Uses a NOT EXISTS check to avoid duplicate notifications for the same
  -- recording (upload_links can have multiple hosts per recording).
  INSERT INTO public.user_notifications (user_id, type, message, related_id, is_read, created_at)
  SELECT
    rq.user_id,
    'recording_available',
    'A new recording of @' || rq.performer_username || ' on ' || rq.platform || ' is now available in the archive!',
    NEW.recording_id::text,
    false,
    NOW()
  FROM public.requests rq
  LEFT JOIN public.user_notification_preferences unp
    ON unp.user_id = rq.user_id
    AND unp.notification_type = 'recording_available'
  WHERE rq.performer_username IS NOT NULL
    AND LOWER(rq.performer_username) = LOWER(v_username)
    AND rq.status IN ('pending', 'approved')
    AND (unp.enabled IS NULL OR unp.enabled = true)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_notifications un
      WHERE un.user_id = rq.user_id
        AND un.type = 'recording_available'
        AND un.related_id = NEW.recording_id::text
    );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_requesters_on_upload()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_username text;
BEGIN
  -- Get the performer username from the associated recording
  SELECT r.username INTO v_username
  FROM public.recordings r
  WHERE r.id = NEW.recording_id;

  -- Skip if recording not found or no username
  IF v_username IS NULL THEN
    RETURN NEW;
  END IF;

  -- Notify all users with pending or approved requests for this performer,
  -- but only if they haven't disabled 'recording_available' notifications.
  -- Uses a NOT EXISTS check to avoid duplicate notifications for the same
  -- recording (upload_links can have multiple hosts per recording).
  INSERT INTO public.user_notifications (user_id, type, message, related_id, is_read, created_at)
  SELECT
    rq.user_id,
    'recording_available',
    'A new recording of @' || rq.performer_username || ' on ' || rq.platform || ' is now available in the archive!',
    NEW.recording_id::text,
    false,
    NOW()
  FROM public.requests rq
  LEFT JOIN public.user_notification_preferences unp
    ON unp.user_id = rq.user_id
    AND unp.notification_type = 'recording_available'
  WHERE rq.performer_username IS NOT NULL
    AND LOWER(rq.performer_username) = LOWER(v_username)
    AND rq.status IN ('pending', 'approved')
    AND (unp.enabled IS NULL OR unp.enabled = true)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_notifications un
      WHERE un.user_id = rq.user_id
        AND un.type = 'recording_available'
        AND un.related_id = NEW.recording_id::text
    );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS update_channels_updated_at ON public.channels;
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_recordings_updated_at ON public.recordings;
CREATE TRIGGER update_recordings_updated_at BEFORE UPDATE ON public.recordings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_nodes_updated_at ON public.nodes;
CREATE TRIGGER update_nodes_updated_at BEFORE UPDATE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_channel_assignments_updated_at ON public.channel_assignments;
CREATE TRIGGER update_channel_assignments_updated_at BEFORE UPDATE ON public.channel_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_notify_requesters_on_upload ON public.upload_links;
CREATE TRIGGER trigger_notify_requesters_on_upload AFTER INSERT ON public.upload_links
  FOR EACH ROW EXECUTE FUNCTION public.notify_requesters_on_upload();

GRANT SELECT ON public.channel_statistics, public.recordings_with_links, public.linked_recordings
  TO anon, authenticated, service_role, postgres;
NOTIFY pgrst, 'reload schema';
