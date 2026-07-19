-- ============================================================
-- Complete Database Schema for recording-archive
-- Synced from the live Supabase project (rvbuzyljrwsxfxijotdf).
-- Idempotent — safe to re-run. Run in Supabase SQL Editor.
-- Generated 2026-07-19T12:34:33.250Z
-- ============================================================

-- ── Extensions ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Tables ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" varchar(255) NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);
ALTER TABLE "app_settings" ADD PRIMARY KEY ("key");
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on app_settings" ON "app_settings" AS PERMISSIVE USING (true) WITH CHECK (true);

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
ALTER TABLE "channel_assignments" ADD PRIMARY KEY ("username", "site");
ALTER TABLE "channel_assignments" ADD CONSTRAINT "channel_assignments_assigned_node_fkey" FOREIGN KEY (assigned_node) REFERENCES nodes(node_id);
ALTER TABLE "channel_assignments" ADD CONSTRAINT "channel_assignments_site_check" CHECK ((site = ANY (ARRAY['chaturbate'::text, 'stripchat'::text])));
ALTER TABLE "channel_assignments" ADD CONSTRAINT "channel_assignments_status_check" CHECK ((status = ANY (ARRAY['unassigned'::text, 'claimed'::text, 'recording'::text, 'paused'::text, 'error'::text])));
CREATE INDEX IF NOT EXISTS "idx_ca_last_recorded" ON "channel_assignments" USING btree (last_recorded_at);
CREATE INDEX IF NOT EXISTS "idx_ca_assigned_node" ON "channel_assignments" USING btree (assigned_node);
CREATE INDEX IF NOT EXISTS "idx_ca_heartbeat" ON "channel_assignments" USING btree (last_heartbeat);
CREATE INDEX IF NOT EXISTS "idx_ca_islive" ON "channel_assignments" USING btree (is_live);
CREATE INDEX IF NOT EXISTS "idx_ca_status" ON "channel_assignments" USING btree (status);
ALTER TABLE "channel_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on channel_assignments" ON "channel_assignments" AS PERMISSIVE USING (true) WITH CHECK (true);

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
ALTER TABLE "channels" ADD PRIMARY KEY ("id");
ALTER TABLE "channels" ADD CONSTRAINT "channels_username_key" UNIQUE (username);
CREATE INDEX IF NOT EXISTS "idx_channels_created_at" ON "channels" USING btree (created_at);
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on channels" ON "channels" AS PERMISSIVE USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "comment_likes" (
  "id" integer NOT NULL DEFAULT nextval('comment_likes_id_seq'::regclass),
  "comment_id" integer NOT NULL,
  "session_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "comment_likes" ADD PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "idx_comment_likes_comment" ON "comment_likes" USING btree (comment_id);
ALTER TABLE "comment_likes" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "comments" ADD PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "idx_comments_recording" ON "comments" USING btree (recording_id);
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "disk_usage" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "total_bytes" bigint NOT NULL,
  "used_bytes" bigint NOT NULL,
  "free_bytes" bigint NOT NULL,
  "percent_used" integer NOT NULL,
  "recorded_at" timestamptz DEFAULT now()
);
ALTER TABLE "disk_usage" ADD PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "idx_disk_usage_recorded_at" ON "disk_usage" USING btree (recorded_at DESC);
ALTER TABLE "disk_usage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on disk_usage" ON "disk_usage" AS PERMISSIVE USING (true) WITH CHECK (true);

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
ALTER TABLE "nodes" ADD PRIMARY KEY ("node_id");
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_status_check" CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text, 'draining'::text])));
CREATE INDEX IF NOT EXISTS "idx_nodes_status" ON "nodes" USING btree (status);
CREATE INDEX IF NOT EXISTS "idx_nodes_session_deadline" ON "nodes" USING btree (session_deadline);
CREATE INDEX IF NOT EXISTS "idx_nodes_heartbeat" ON "nodes" USING btree (last_heartbeat);
ALTER TABLE "nodes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on nodes" ON "nodes" AS PERMISSIVE USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "performer_follows" (
  "id" integer NOT NULL DEFAULT nextval('performer_follows_id_seq'::regclass),
  "user_id" text NOT NULL,
  "performer_username" text NOT NULL,
  "followed_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "performer_follows" ADD PRIMARY KEY ("id");
ALTER TABLE "performer_follows" ADD CONSTRAINT "performer_follows_uniq" UNIQUE (user_id, performer_username);
CREATE INDEX IF NOT EXISTS "idx_performer_follows_user" ON "performer_follows" USING btree (user_id);
ALTER TABLE "performer_follows" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "pipeline_states" ADD PRIMARY KEY ("file_hash");
ALTER TABLE "pipeline_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on pipeline_states" ON "pipeline_states" AS PERMISSIVE USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "pool_autopilot" (
  "username" text NOT NULL,
  "gender" text NOT NULL,
  "viewers" integer NOT NULL DEFAULT 0,
  "added_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "pool_autopilot" ADD PRIMARY KEY ("username");
CREATE INDEX IF NOT EXISTS "idx_pool_autopilot_gender" ON "pool_autopilot" USING btree (gender);
ALTER TABLE "pool_autopilot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on pool_autopilot" ON "pool_autopilot" AS PERMISSIVE USING (true) WITH CHECK (true);

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
ALTER TABLE "preview_images" ADD PRIMARY KEY ("id");
ALTER TABLE "preview_images" ADD CONSTRAINT "preview_images_filename_key" UNIQUE (filename);
ALTER TABLE "preview_images" ADD CONSTRAINT "preview_images_recording_id_fkey" FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_preview_images_instance" ON "preview_images" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_preview_images_recording_id" ON "preview_images" USING btree (recording_id);
ALTER TABLE "preview_images" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on preview_images" ON "preview_images" AS PERMISSIVE USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "reactions" (
  "id" integer NOT NULL DEFAULT nextval('reactions_id_seq'::regclass),
  "recording_id" text NOT NULL,
  "session_id" text NOT NULL,
  "type" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "reactions" ADD PRIMARY KEY ("id");
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_recording_session_uniq" UNIQUE (recording_id, session_id);
CREATE INDEX IF NOT EXISTS "idx_reactions_recording" ON "reactions" USING btree (recording_id);
ALTER TABLE "reactions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on reactions" ON "reactions" AS PERMISSIVE USING (true) WITH CHECK (true);

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
ALTER TABLE "recordings" ADD PRIMARY KEY ("id");
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_filename_key" UNIQUE (filename);
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_channel_id_fkey" FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_recordings_channel_id" ON "recordings" USING btree (channel_id);
CREATE INDEX IF NOT EXISTS "idx_recordings_username" ON "recordings" USING btree (username);
CREATE INDEX IF NOT EXISTS "idx_recordings_gender" ON "recordings" USING btree (gender);
CREATE INDEX IF NOT EXISTS "idx_recordings_instance" ON "recordings" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_recordings_timestamp" ON "recordings" USING btree ("timestamp" DESC);
ALTER TABLE "recordings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on recordings" ON "recordings" AS PERMISSIVE USING (true) WITH CHECK (true);

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
ALTER TABLE "requests" ADD PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "idx_requests_user" ON "requests" USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_requests_user_platform_performer" ON "requests" USING btree (user_id, platform, COALESCE(performer_username, ''::text), COALESCE(stream_link, ''::text));
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "saved_videos" (
  "id" integer NOT NULL DEFAULT nextval('saved_videos_id_seq'::regclass),
  "user_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "saved_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "saved_videos" ADD PRIMARY KEY ("id");
ALTER TABLE "saved_videos" ADD CONSTRAINT "saved_videos_uniq" UNIQUE (user_id, recording_id);
CREATE INDEX IF NOT EXISTS "idx_saved_videos_user" ON "saved_videos" USING btree (user_id);
ALTER TABLE "saved_videos" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "tunnels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "url" text NOT NULL,
  "run_id" integer,
  "is_active" boolean DEFAULT true,
  "instance_id" text NOT NULL DEFAULT 'default'::text,
  "created_at" timestamptz DEFAULT now(),
  "expires_at" timestamptz
);
ALTER TABLE "tunnels" ADD PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "idx_tunnels_run_id" ON "tunnels" USING btree (run_id);
CREATE INDEX IF NOT EXISTS "idx_tunnels_instance" ON "tunnels" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_tunnels_active" ON "tunnels" USING btree (is_active, created_at DESC);
ALTER TABLE "tunnels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on tunnels" ON "tunnels" AS PERMISSIVE USING (true) WITH CHECK (true);

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
ALTER TABLE "upload_journal" ADD PRIMARY KEY ("id");
ALTER TABLE "upload_journal" ADD CONSTRAINT "upload_journal_file_hash_host_key" UNIQUE (file_hash, host);
CREATE INDEX IF NOT EXISTS "idx_upload_journal_status" ON "upload_journal" USING btree (status);
CREATE INDEX IF NOT EXISTS "idx_upload_journal_hash" ON "upload_journal" USING btree (file_hash);
ALTER TABLE "upload_journal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on upload_journal" ON "upload_journal" AS PERMISSIVE USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "upload_links" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "recording_id" uuid,
  "host" varchar(100) NOT NULL,
  "url" text NOT NULL,
  "instance_id" text NOT NULL DEFAULT 'default'::text,
  "uploaded_at" timestamptz DEFAULT now()
);
ALTER TABLE "upload_links" ADD PRIMARY KEY ("id");
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_recording_host_unique" UNIQUE (recording_id, host);
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_recording_id_fkey" FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_upload_links_host" ON "upload_links" USING btree (host);
CREATE INDEX IF NOT EXISTS "idx_upload_links_instance" ON "upload_links" USING btree (instance_id);
CREATE INDEX IF NOT EXISTS "idx_upload_links_recording_id" ON "upload_links" USING btree (recording_id);
ALTER TABLE "upload_links" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on upload_links" ON "upload_links" AS PERMISSIVE USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "user_collection_items" (
  "id" integer NOT NULL DEFAULT nextval('user_collection_items_id_seq'::regclass),
  "collection_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "added_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "user_collection_items" ADD PRIMARY KEY ("id");
ALTER TABLE "user_collection_items" ADD CONSTRAINT "collection_items_uniq" UNIQUE (collection_id, recording_id);
ALTER TABLE "user_collection_items" ADD CONSTRAINT "user_collection_items_collection_id_fkey" FOREIGN KEY (collection_id) REFERENCES user_collections(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_collection_items_collection" ON "user_collection_items" USING btree (collection_id);
ALTER TABLE "user_collection_items" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "user_collections" (
  "id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "user_collections" ADD PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "idx_collections_user" ON "user_collections" USING btree (user_id);
ALTER TABLE "user_collections" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" integer NOT NULL DEFAULT nextval('user_notifications_id_seq'::regclass),
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "message" text NOT NULL,
  "related_id" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "user_notifications" ADD PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "user_notifications" USING btree (user_id);
CREATE INDEX IF NOT EXISTS "idx_notifications_unread" ON "user_notifications" USING btree (user_id, is_read);
ALTER TABLE "user_notifications" ENABLE ROW LEVEL SECURITY;

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
ALTER TABLE "user_profiles" ADD PRIMARY KEY ("user_id");
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_username_key" UNIQUE (username);
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "user_roles" (
  "user_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'user'::text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "user_roles" ADD PRIMARY KEY ("user_id");
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'moderator'::text, 'admin'::text])));
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "watch_history" (
  "id" integer NOT NULL DEFAULT nextval('watch_history_id_seq'::regclass),
  "user_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "watched_at" timestamptz NOT NULL DEFAULT now(),
  "progress_seconds" integer NOT NULL DEFAULT 0,
  "duration_seconds" integer
);
ALTER TABLE "watch_history" ADD PRIMARY KEY ("id");
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_uniq" UNIQUE (user_id, recording_id);
CREATE INDEX IF NOT EXISTS "idx_watch_history_user" ON "watch_history" USING btree (user_id);
ALTER TABLE "watch_history" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "watch_later_items" (
  "id" integer NOT NULL DEFAULT nextval('watch_later_items_id_seq'::regclass),
  "user_id" text NOT NULL,
  "recording_id" text NOT NULL,
  "metadata" text,
  "added_at" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "watch_later_items" ADD PRIMARY KEY ("id");
ALTER TABLE "watch_later_items" ADD CONSTRAINT "watch_later_uniq" UNIQUE (user_id, recording_id);
CREATE INDEX IF NOT EXISTS "idx_watch_later_user" ON "watch_later_items" USING btree (user_id);
ALTER TABLE "watch_later_items" ENABLE ROW LEVEL SECURITY;

-- ── Views ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.channel_statistics
  SECURITY INVOKER
  AS
  SELECT c.username,
    c.is_paused,
    count(r.id) AS total_recordings,
    sum(r.filesize) AS total_filesize_bytes,
    max(r."timestamp") AS last_recording_at,
    avg(r.viewers) AS avg_viewers,
    c.created_at,
    c.updated_at
   FROM channels c
     LEFT JOIN recordings r ON c.username::text = r.username::text
  GROUP BY c.id, c.username, c.is_paused, c.created_at, c.updated_at;;
CREATE OR REPLACE VIEW public.recordings_with_links
  SECURITY INVOKER
  AS
  SELECT r.id,
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
    COALESCE(json_object_agg(ul.host, ul.url) FILTER (WHERE ul.host IS NOT NULL), '{}'::json) AS links
   FROM recordings r
     LEFT JOIN upload_links ul ON r.id = ul.recording_id
  GROUP BY r.id;;

-- ── Functions ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_channel(p_channel_id text, p_repo text)
 RETURNS TABLE(recording_id uuid, token uuid)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_recording_id uuid;
    v_token uuid;
BEGIN
    INSERT INTO recordings (channel_id, repo_node, lock_token, lock_expires_at)
    VALUES (p_channel_id, p_repo, gen_random_uuid(), now() + interval '90 seconds')
    ON CONFLICT (channel_id, active) WHERE active = true DO NOTHING
    RETURNING id, lock_token INTO v_recording_id, v_token;
    IF v_recording_id IS NULL THEN
        UPDATE recordings
        SET repo_node = p_repo,
            lock_token = gen_random_uuid(),
            lock_expires_at = now() + interval '90 seconds',
            started_at = now()
        WHERE channel_id = p_channel_id
          AND active = true
          AND (lock_expires_at IS NULL OR lock_expires_at < now())
        RETURNING id, lock_token INTO v_recording_id, v_token;
    END IF;
    RETURN QUERY SELECT v_recording_id, v_token;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_channels(p_node_id text, p_limit integer)
 RETURNS SETOF channel_assignments
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT username, site
    FROM public.channel_assignments
    WHERE assigned_node IS NULL
      AND status = 'unassigned'
    ORDER BY username ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.channel_assignments ca
  SET assigned_node  = p_node_id,
      status         = 'claimed',
      assigned_at    = NOW(),
      last_heartbeat = NOW()
  FROM candidates c
  WHERE ca.username = c.username
    AND ca.site = c.site
  RETURNING ca.*;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_specific_channel(p_username text, p_site text, p_node_id text)
 RETURNS SETOF channel_assignments
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT username, site
    FROM public.channel_assignments
    WHERE username = p_username
      AND site = p_site
      AND assigned_node IS NULL
      AND status = 'unassigned'
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.channel_assignments ca
  SET assigned_node  = p_node_id,
      status         = 'claimed',
      assigned_at    = NOW(),
      last_heartbeat = NOW()
  FROM candidate c
  WHERE ca.username = c.username
    AND ca.site = c.site
  RETURNING ca.*;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.clean_stale_locks()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    UPDATE recordings
    SET active = false,
        ended_at = now(),
        lock_token = null,
        lock_expires_at = null
    WHERE active = true
      AND lock_expires_at < now()
    RETURNING id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.finalize_recording(p_recording_id uuid, p_token uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE recordings
    SET active = false,
        ended_at = now(),
        lock_token = null,
        lock_expires_at = null
    WHERE id = p_recording_id
      AND lock_token = p_token;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.increment_video_views(video_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE video_uploads SET views = COALESCE(views, 0) + 1 WHERE id = video_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_old_tunnels_inactive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE tunnel_sessions
    SET is_active = FALSE
    WHERE id != NEW.id AND is_active = TRUE;
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reassign_channel(p_username text, p_site text, p_from_node text, p_to_node text)
 RETURNS SETOF channel_assignments
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH cand AS (
    SELECT username, site
    FROM channel_assignments
    WHERE username = p_username
      AND site = p_site
      AND assigned_node = p_from_node
    FOR UPDATE SKIP LOCKED
  )
  UPDATE channel_assignments ca
  SET assigned_node  = p_to_node,
      status         = 'claimed',
      assigned_at    = NOW(),
      last_heartbeat = NOW()
  FROM cand c
  WHERE ca.username = c.username AND ca.site = c.site
  RETURNING ca.*;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.renew_lock(p_recording_id uuid, p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE recordings
    SET lock_expires_at = now() + interval '90 seconds'
    WHERE id = p_recording_id
      AND active = true
      AND lock_token = p_token;
    RETURN FOUND;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_username(p_username text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_email TEXT;
  v_our_id TEXT := '042f11b1-8b0a-4c12-b6cb-091b33e6d64f';
BEGIN
  SELECT au.email INTO v_email
  FROM auth.users au
    WHERE au.id = v_our_id::uuid
    AND (
      au.raw_user_meta_data->>'display_name' ILIKE p_username
      OR au.raw_user_meta_data->>'username' ILIKE p_username
    )
  LIMIT 1;
  IF v_email IS NULL THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE
      au.raw_user_meta_data->>'display_name' ILIKE p_username
      OR au.raw_user_meta_data->>'username' ILIKE p_username
    LIMIT 1;
  END IF;
  RETURN v_email;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_streamers_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;
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

-- ── Triggers ─────────────────────────────────────────────
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recordings_updated_at BEFORE UPDATE ON public.recordings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_nodes_updated_at BEFORE UPDATE ON public.nodes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_channel_assignments_updated_at BEFORE UPDATE ON public.channel_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Missing policies (RLS without policies fix) ───────
CREATE POLICY "Allow all operations on comment_likes" ON "comment_likes" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on comments" ON "comments" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on performer_follows" ON "performer_follows" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on requests" ON "requests" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on saved_videos" ON "saved_videos" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_collection_items" ON "user_collection_items" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_collections" ON "user_collections" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_notifications" ON "user_notifications" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_profiles" ON "user_profiles" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_roles" ON "user_roles" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on watch_history" ON "watch_history" AS PERMISSIVE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on watch_later_items" ON "watch_later_items" AS PERMISSIVE USING (true) WITH CHECK (true);
