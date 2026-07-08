import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";

const migrationSql = `
-- User Profiles
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

-- User Roles (for role-based access control)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Saved Videos (Bookmarks)
CREATE TABLE IF NOT EXISTS saved_videos (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_videos_uniq UNIQUE (user_id, recording_id)
);

-- Watch History
CREATE TABLE IF NOT EXISTS watch_history (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT watch_history_uniq UNIQUE (user_id, recording_id)
);

-- Watch Later Items
CREATE TABLE IF NOT EXISTS watch_later_items (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT watch_later_uniq UNIQUE (user_id, recording_id)
);

-- User Collections
CREATE TABLE IF NOT EXISTS user_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User Collection Items
CREATE TABLE IF NOT EXISTS user_collection_items (
  id SERIAL PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES user_collections(id) ON DELETE CASCADE,
  recording_id TEXT NOT NULL,
  metadata TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collection_items_uniq UNIQUE (collection_id, recording_id)
);

-- Performer Follows
CREATE TABLE IF NOT EXISTS performer_follows (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  performer_username TEXT NOT NULL,
  followed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performer_follows_uniq UNIQUE (user_id, performer_username)
);

-- User Notifications
CREATE TABLE IF NOT EXISTS user_notifications (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Requests table
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

-- Reactions table
CREATE TABLE IF NOT EXISTS reactions (
  id SERIAL PRIMARY KEY,
  recording_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reactions_recording_session_uniq UNIQUE (recording_id, session_id)
);

-- Comments table
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

-- Comment Likes
CREATE TABLE IF NOT EXISTS comment_likes (
  id SERIAL PRIMARY KEY,
  comment_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_saved_videos_user ON saved_videos(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_later_user ON watch_later_items(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON user_collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_performer_follows_user ON performer_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON user_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_reactions_recording ON reactions(recording_id);
CREATE INDEX IF NOT EXISTS idx_comments_recording ON comments(recording_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
`;

const router = Router();

router.get("/migrate-auth", async (_req: Request, res: Response) => {
  try {
    console.log("[migrate-auth] Running migration...");
    await pool.query(migrationSql);
    console.log("[migrate-auth] Migration completed");

    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    const tables = result.rows.map((r: any) => r.table_name);
    console.log("[migrate-auth] Tables:", tables);

    res.json({ success: true, tables });
  } catch (err: any) {
    console.error("[migrate-auth] Failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
