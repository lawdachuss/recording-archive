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
