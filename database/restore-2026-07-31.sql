-- ============================================================
-- Restored DB objects for new Supabase project dydfzytjwhrqozuiexbb
-- Extracted from database/schema.sql (git HEAD) and applied 2026-07-31.
-- Idempotent — safe to re-run in the Supabase SQL Editor.
--
-- NOTE: public.reassign_channel was NOT restored from this file — the new
-- project already had a version with a different return type. The live
-- definition is the one that was already present on the new DB.
--
-- Restores:
--   * Views: channel_statistics, recordings_with_links (security_invoker)
--   * Functions: resolve_username, increment_video_views, claim_channels,
--     claim_specific_channel, finalize_recording, renew_lock,
--     clean_stale_locks, mark_old_tunnels, notify_requesters, rls_auto_enable
--   * Triggers: updated_at touch on channels/recordings/app_settings/nodes/
--     channel_assignments + notify_requesters_on_upload
--   * Grants: SELECT on views + EXECUTE on RPC functions
-- ============================================================
CREATE OR REPLACE VIEW public.channel_statistics
  WITH (security_invoker = true)
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
  WITH (security_invoker = true)
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
    NULLIF(jsonb_object_agg(ul.host, ul.url) FILTER (WHERE ul.host IS NOT NULL), '{}'::jsonb)::json AS links
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

-- ── Triggers ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_channels_updated_at ON public.channels;
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_recordings_updated_at ON public.recordings;
CREATE TRIGGER update_recordings_updated_at BEFORE UPDATE ON public.recordings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_nodes_updated_at ON public.nodes;
CREATE TRIGGER update_nodes_updated_at BEFORE UPDATE ON public.nodes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_channel_assignments_updated_at ON public.channel_assignments;
CREATE TRIGGER update_channel_assignments_updated_at BEFORE UPDATE ON public.channel_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trigger_notify_requesters_on_upload ON public.upload_links;
CREATE TRIGGER trigger_notify_requesters_on_upload AFTER INSERT ON public.upload_links FOR EACH ROW EXECUTE FUNCTION notify_requesters_on_upload();

-- ── Grants ─────────────────────────────────────────────
GRANT SELECT ON public.channel_statistics, public.recordings_with_links
  TO anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.resolve_username(text)
  TO anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.increment_video_views(text)
  TO anon, authenticated, service_role, postgres;
