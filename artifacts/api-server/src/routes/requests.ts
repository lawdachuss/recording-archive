import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { invalidateOnSuccess } from "../middleware/cache.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

const admin = requireRole("admin");

const REQUEST_COLS = "id,user_id,platform,performer_username,stream_link,notes,priority,status,created_at";

router.get("/requests", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("requests")
      .select(REQUEST_COLS)
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      req.log?.error?.({ err: error }, "GET /requests supabase error");
      res.json([]);
      return;
    }
    res.json(data ?? []);
  } catch {
    res.json([]);
  }
});

router.post("/requests", requireAuth, async (req, res) => {
  const { platform, performer_username, stream_link, notes, priority } = req.body as {
    platform?: string;
    performer_username?: string;
    stream_link?: string;
    notes?: string;
    priority?: string;
  };

  if (!platform || !["chaturbate", "stripchat"].includes(platform)) {
    res.status(400).json({ error: "platform is required and must be 'chaturbate' or 'stripchat'" });
    return;
  }

  if (!performer_username && !stream_link) {
    res.status(400).json({ error: "performer_username or stream_link is required" });
    return;
  }

  const validPriority = ["low", "normal", "high"].includes(priority ?? "") ? priority : "normal";

  // If the performer already has recordings in the archive, reject the request
  // immediately — there's nothing to capture.
  if (performer_username) {
    try {
      const { count, error } = await supabase
        .from("recordings_with_links")
        .select("id", { count: "exact", head: true })
        .ilike("username", performer_username)
        .not("links", "is", "null");

      if (error) throw error;
      const recordingCount = count ?? 0;
      if (recordingCount > 0) {
        res.status(409).json({
          error: `@${performer_username} already has ${recordingCount} recording${recordingCount === 1 ? "" : "s"} in the archive.`,
          recording_count: recordingCount,
        });
        return;
      }
    } catch (err) {
      console.error("[requests] existing-recordings check failed:", err);
      // If the check fails, fall through to the normal flow
    }
  }

  // Prevent duplicate requests: a user cannot request the same performer on the
  // same platform more than once. If a duplicate is attempted, return the
  // existing request instead of creating a redundant channel.
  //
  // NOTE: The database has a UNIQUE INDEX (not a named CONSTRAINT) on
  // (user_id, platform, COALESCE(performer_username,''), COALESCE(stream_link,'')),
  // so we cannot use ON CONFLICT ON CONSTRAINT. We instead rely on the pre-insert
  // dedupe check + the UNIQUE INDEX to catch race conditions, with a fallback
  // that looks up the existing row in the error path.
  const dedupeKey = performer_username ? performer_username : stream_link;
  if (dedupeKey) {
    try {
      const existing = await findDuplicate(req.user!.id, platform, performer_username, stream_link);
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    } catch {
      // If the dedupe check fails, fall through to the insert attempt.
    }
  }

  try {
    // Simple INSERT — the unique index handles duplicate rejection, and we
    // catch unique-violation errors in the catch block below.
    const { data: created, error } = await supabase
      .from("requests")
      .insert({
        user_id: req.user!.id,
        platform,
        performer_username: performer_username ?? null,
        stream_link: stream_link ?? null,
        notes: notes ?? null,
        priority: validPriority,
        status: "pending",
      })
      .select(REQUEST_COLS)
      .single();

    if (error) throw error;

    // Create a confirmation notification for the requester (if enabled)
    try {
      const pref = await getNotificationPref(created.user_id, "request_submitted");
      const enabled = pref.enabled; // default: enabled (true)
      if (enabled) {
        const performerName = created.performer_username ?? "a performer";
        const message = `Your request for @${performerName} on ${created.platform} has been submitted and is pending review.`;
        await supabase.from("user_notifications").insert({
          user_id: created.user_id,
          type: "request_submitted",
          message,
          related_id: String(created.id),
          is_read: false,
        });
      }
    } catch {
      // Non-critical — don't fail the request if notification insert fails
    }

    res.status(201).json(created);
  } catch {
    // Catch: unique-violation from the index, or any other error.
    // Return the existing row if this was a duplicate.
    try {
      const existing = await findDuplicate(req.user!.id, platform, performer_username, stream_link);
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    } catch {
      // Fallback lookup also failed — return a proper error.
    }
    res.status(500).json({ error: "Failed to submit request. Please try again." });
  }
});

/** Look up a request matching the (user, platform, performer/stream) dedupe key. */
async function findDuplicate(
  userId: string,
  platform: string,
  performerUsername?: string,
  streamLink?: string,
) {
  let query = supabase
    .from("requests")
    .select(REQUEST_COLS)
    .eq("user_id", userId)
    .eq("platform", platform);

  // COALESCE(col, '') = COALESCE($param, '') → null matches the empty string.
  if (performerUsername) {
    query = query.eq("performer_username", performerUsername);
  } else {
    query = query.or(`performer_username.is.null,performer_username.eq.`);
  }

  if (streamLink) {
    query = query.eq("stream_link", streamLink);
  } else {
    query = query.or(`stream_link.is.null,stream_link.eq.`);
  }

  const { data } = await query.limit(1).maybeSingle();
  return data;
}

/** Read a notification preference, defaulting to enabled when unset. */
async function getNotificationPref(userId: string, type: string): Promise<{ enabled: boolean }> {
  const { data } = await supabase
    .from("user_notification_preferences")
    .select("enabled")
    .eq("user_id", userId)
    .eq("notification_type", type)
    .maybeSingle();
  return { enabled: data?.enabled ?? true };
}

router.delete("/requests/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid request ID" });
      return;
    }

    const { data, error } = await supabase
      .from("requests")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .select("id");

    if (error) {
      req.log?.error?.({ err: error }, "DELETE /requests/:id supabase error");
      res.status(500).json({ error: "Failed to delete request" });
      return;
    }

    if (!data || data.length === 0) {
      res.status(404).json({ error: "Request not found or not yours to delete" });
      return;
    }

    // Also clean up related notifications
    try {
      await supabase
        .from("user_notifications")
        .delete()
        .eq("user_id", req.user!.id)
        .eq("related_id", String(id))
        .in("type", ["request_status", "request_submitted"]);
    } catch {
      // Non-critical — don't fail the request if notification cleanup fails
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete request" });
  }
});

router.patch("/requests/:id/status", ...admin, invalidateOnSuccess(["performers", "recordings", "stats", "tags"]), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const { status } = req.body as { status?: string };

  const valid = ["pending", "approved", "rejected", "done"];
  if (!status || !valid.includes(status)) {
    res.status(400).json({ error: "status must be one of: pending, approved, rejected, done" });
    return;
  }

  try {
    const { data, error } = await supabase
      .from("requests")
      .update({ status })
      .eq("id", id)
      .select(REQUEST_COLS)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        res.status(404).json({ error: "Request not found" });
        return;
      }
      throw error;
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to update status" });
  }
});

export default router;
