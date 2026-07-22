import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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

    const channel = supabase
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
        if (status !== "SUBSCRIBED") {
          console.warn(
            `[realtime] notification subscription status: ${status}. ` +
            "Ensure Realtime is enabled on the user_notifications table " +
            "in the Supabase dashboard (Database > Replication).",
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
