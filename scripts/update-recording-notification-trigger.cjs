/**
 * Migration: Update notify_requesters_on_upload() to check notification preferences
 *
 * The trigger function now skips users who have disabled the "recording_available"
 * notification type in their user_notification_preferences.
 *
 * Run: DATABASE_URL="postgresql://..." node scripts/update-recording-notification-trigger.cjs
 */
const { Client } = require("pg");

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    console.log("⏳ Updating notify_requesters_on_upload() function...");

    await client.query(`
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
    `);

    console.log("✅ Function updated successfully");

    // Verify
    const { rows } = await client.query(
      `SELECT prosrc FROM pg_proc
       WHERE proname = 'notify_requesters_on_upload'
         AND pronamespace = 'public'::regnamespace`
    );
    if (rows.length > 0) {
      const hasPrefCheck = rows[0].prosrc.includes("user_notification_preferences");
      console.log(hasPrefCheck
        ? "  ✓ Verification passed — function includes preference check"
        : "  ⚠️ Preference check NOT found in function body"
      );
    } else {
      console.log("  ⚠️ Function not found after migration");
    }

    console.log("\n✅ Migration complete!");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
