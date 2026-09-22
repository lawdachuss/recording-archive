import { supabase } from "./supabase.js";

export const NOTIFICATION_TYPES = ["request_submitted", "request_status", "recording_available"] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Create an in-app notification for a user, respecting their per-type
 * preference (defaults to enabled when no preference row exists).
 *
 * Delivery failures are non-critical: this helper never throws, so a
 * notification glitch can't fail the request that triggered it.
 */
export async function notifyUser(params: {
  userId: string;
  type: NotificationType;
  message: string;
  relatedId?: string;
}): Promise<void> {
  try {
    const { userId, type, message, relatedId } = params;

    const { data: pref } = await supabase
      .from("user_notification_preferences")
      .select("enabled")
      .eq("user_id", userId)
      .eq("notification_type", type)
      .maybeSingle();

    // Default: enabled when unset.
    if (pref && pref.enabled === false) return;

    await supabase.from("user_notifications").insert({
      user_id: userId,
      type,
      message,
      related_id: relatedId ?? null,
      is_read: false,
    });
  } catch (err) {
    // Non-critical — swallow so the caller flow succeeds regardless.
    console.warn(`[notify] failed to deliver ${params.type} notification:`, err);
  }
}