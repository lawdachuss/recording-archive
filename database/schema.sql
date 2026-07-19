-- ============================================================
-- Complete Database Schema for recording-archive
-- Idempotent — safe to re-run (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Core tables ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  username TEXT,
  filename TEXT,
  timestamp TIMESTAMPTZ,
  room_title TEXT,
  tags TEXT[],
  viewers INTEGER,
  resolution TEXT,
  framerate NUMERIC,
  filesize BIGINT,
  duration NUMERIC,
  gender TEXT,
  thumbnail_url TEXT,
  sprite_url TEXT,
  embed_url TEXT,
  preview_url TEXT,
  links JSONB DEFAULT '{}'::jsonb,
  instance_id TEXT,
  stream_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS upload_links (
  recording_id TEXT NOT NULL REFERENCES recordings(id),
  host TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preview_images (
  recording_id TEXT NOT NULL REFERENCES recordings(id),
  filename TEXT,
  preview_url TEXT,
  thumbnail_url TEXT,
  sprite_url TEXT
);

-- ── User feature tables ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  username TEXT UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_videos (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_videos_uniq UNIQUE (user_id, recording_id)
);

CREATE TABLE IF NOT EXISTS watch_history (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT watch_history_uniq UNIQUE (user_id, recording_id)
);

CREATE TABLE IF NOT EXISTS watch_later_items (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT watch_later_uniq UNIQUE (user_id, recording_id)
);

CREATE TABLE IF NOT EXISTS user_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_collection_items (
  id SERIAL PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES user_collections(id) ON DELETE CASCADE,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collection_items_uniq UNIQUE (collection_id, recording_id)
);

CREATE TABLE IF NOT EXISTS performer_follows (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  performer_username TEXT NOT NULL,
  followed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performer_follows_uniq UNIQUE (user_id, performer_username)
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'chaturbate',
  performer_username TEXT,
  stream_link TEXT,
  notes TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reactions (
  id SERIAL PRIMARY KEY,
  recording_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reactions_recording_session_uniq UNIQUE (recording_id, session_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  recording_id TEXT NOT NULL,
  parent_id INTEGER,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  session_id TEXT,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comment_likes (
  id SERIAL PRIMARY KEY,
  comment_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_recordings_valid_timestamp_desc
  ON recordings (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_valid_timestamp_asc
  ON recordings (timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_recordings_valid_viewers_desc
  ON recordings (viewers DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_recordings_valid_filesize_desc
  ON recordings (filesize DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_recordings_valid_gender
  ON recordings (gender, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_valid_resolution
  ON recordings (resolution, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_valid_username
  ON recordings (username, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_tags_gin
  ON recordings USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_upload_links_recording_host
  ON upload_links (recording_id, host);

CREATE INDEX IF NOT EXISTS idx_saved_videos_user ON saved_videos(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_later_user ON watch_later_items(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON user_collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_performer_follows_user ON performer_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON user_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_recording ON reactions(recording_id);
CREATE INDEX IF NOT EXISTS idx_comments_recording ON comments(recording_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);

-- ── View ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW recordings_with_links AS
 SELECT r.id,
     r.channel_id,
     r.username,
     r.filename,
     r.timestamp,
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
     r.instance_id,
     r.created_at,
     r.updated_at,
     COALESCE(json_object_agg(ul.host, ul.url) FILTER (WHERE ul.host IS NOT NULL), '{}'::json) AS links
    FROM recordings r
      LEFT JOIN upload_links ul ON r.id = ul.recording_id
   GROUP BY r.id;

-- ── RPC function ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email
  FROM auth.users
  WHERE raw_user_meta_data->>'username' = p_username;
  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_username TO anon;
