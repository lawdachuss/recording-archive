import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";

const NOTIF_QUERY_KEY = ["user", "notifications"];

/**
 * Subscribes to real-time INSERT/UPDATE events on the `user_notifications`
 * table for the given user, and invalidates the notifications query cache
 * so the UI updates instantly without polling.
 *
 * Pass `null` as userId when the user is not logged in (subscription skipped).
 */
export function useRealtimeNotifications(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    let unsub: (() => void) | null = null;
    getSupabase()
      .then((sb) => {
        const channel = sb
          .channel("notifications-realtime")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "user_notifications",
              filter: `user_id=eq.${userId}`,
            },
            () => {
              queryClient.invalidateQueries({ queryKey: NOTIF_QUERY_KEY });
            },
          )
          .subscribe((status) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.warn(
                `[realtime] notification subscription failed: ${status}. ` +
                "Ensure Realtime is enabled on the user_notifications table " +
                "in the Supabase dashboard (Database > Replication).",
              );
            }
          });
        unsub = () => { sb.removeChannel(channel); };
      })
      .catch((err) => {
        // Supabase SDK load / client init failed (e.g. chunk load) — never
        // let it surface as an unhandled rejection.
        console.warn("[realtime] notifications disabled:", err?.message ?? err);
      });

    return () => { unsub?.(); };
  }, [userId, queryClient]);
}
