-- ============================================================
-- Migration: Fix resolve_username + add recording_available trigger
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- Last updated: 2026-07-21
-- ============================================================

-- ── 1. Fix resolve_username RPC function ─────────────────
-- The old function only checked auth.users.raw_user_meta_data,
-- but the actual username is stored in public.user_profiles.
-- This made login by username impossible for most users.

CREATE OR REPLACE FUNCTION public.resolve_username(p_username text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_email TEXT;
BEGIN
  -- First check user_profiles table (the primary username store)
  SELECT up.email INTO v_email
  FROM public.user_profiles up
  WHERE LOWER(up.username) = LOWER(p_username)
  LIMIT 1;
  
  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;
  
  -- Fallback: check auth.users raw_user_meta_data
  SELECT au.email INTO v_email
  FROM auth.users au
  WHERE 
    LOWER(au.raw_user_meta_data->>'display_name') = LOWER(p_username)
    OR LOWER(au.raw_user_meta_data->>'username') = LOWER(p_username)
  LIMIT 1;
  
  RETURN v_email;
END;
$function$;

-- ── 2. Add trigger to notify users when a matching recording is uploaded ──
-- When an upload_link is inserted (making a recording accessible),
-- this checks for users with pending/approved requests for that performer
-- and creates notifications for them.

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

  -- Notify all users with pending or approved requests for this performer.
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
  WHERE rq.performer_username IS NOT NULL
    AND LOWER(rq.performer_username) = LOWER(v_username)
    AND rq.status IN ('pending', 'approved')
    AND NOT EXISTS (
      SELECT 1 FROM public.user_notifications un
      WHERE un.user_id = rq.user_id
        AND un.type = 'recording_available'
        AND un.related_id = NEW.recording_id::text
    );

  RETURN NEW;
END;
$function$;

-- Drop the trigger first if it already exists (idempotent)
DROP TRIGGER IF EXISTS trigger_notify_requesters_on_upload ON public.upload_links;

-- Create the trigger
CREATE TRIGGER trigger_notify_requesters_on_upload
  AFTER INSERT ON public.upload_links
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_requesters_on_upload();

-- ── 3. Verify the changes ─────────────────────────────────
-- Run these queries to verify:
--   SELECT resolve_username('your-username') AS email;
--   SELECT * FROM information_schema.triggers WHERE trigger_name = 'trigger_notify_requesters_on_upload';
