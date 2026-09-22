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
