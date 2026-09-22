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
