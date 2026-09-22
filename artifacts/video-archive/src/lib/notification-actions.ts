import type { UserNotification } from "@/lib/user-api";

export interface NotificationAction {
  label: string;
  href: string;
}

/**
 * Resolve the deep-link target for an actionable notification.
 * Request notifications point at the request detail page; "recording
 * available" ones point straight at the video.
 */
export function getNotificationAction(n: {
  type: string;
  related_id: string | null;
}): NotificationAction | null {
  if (!n.related_id) return null;

  if (n.type === "request_status" || n.type === "request_submitted") {
    return { label: "View request", href: `/request?id=${encodeURIComponent(n.related_id)}` };
  }

  if (n.type === "recording_available") {
    return { label: "View recording", href: `/video/${encodeURIComponent(n.related_id)}` };
  }

  return null;
}

export function isActionableNotification(n: Pick<UserNotification, "type">): boolean {
  return n.type === "request_status" || n.type === "request_submitted" || n.type === "recording_available";
}