import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const NOTIF_QUERY_KEY = ["user", "notifications"];

let activeChannel: RealtimeChannel | null = null;
let currentUserId: string | null = null;
let refCount = 0;

/**
 * Subscribes to real-time INSERT/UPDATE events on the `user_notifications`
 * table for the given user, and invalidates the notifications query cache
 * so the UI updates instantly without polling.
 *
 * Safe to call from multiple components simultaneously (e.g. Header bell and
 * Notifications page) via internal reference counting.
 */
export function useRealtimeNotifications(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const uid = userId;

    let mounted = true;

    async function setup() {
      try {
        const sb = await getSupabase();
        if (!mounted) return;

        // If user changed, tear down old channel
        if (activeChannel && currentUserId !== uid) {
          try {
            await sb.removeChannel(activeChannel);
          } catch {}
          activeChannel = null;
          refCount = 0;
        }

        refCount++;
        currentUserId = uid;

        // Only create a single channel if one isn't already active
        if (!activeChannel) {
          const channelName = `notif-${uid}-${Math.random().toString(36).slice(2, 8)}`;
          const channel = sb
            .channel(channelName)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "user_notifications",
                filter: `user_id=eq.${uid}`,
              },
              () => {
                queryClient.invalidateQueries({ queryKey: NOTIF_QUERY_KEY });
              },
            )
            .subscribe((status) => {
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                console.warn(
                  `[realtime] notification subscription failed: ${status}. ` +
                  "Ensure Realtime is enabled on user_notifications table.",
                );
              }
            });

          activeChannel = channel;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[realtime] notifications disabled:", msg);
      }
    }

    setup();

    return () => {
      mounted = false;
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0 && activeChannel) {
        getSupabase()
          .then((sb) => {
            if (activeChannel && refCount === 0) {
              sb.removeChannel(activeChannel);
              activeChannel = null;
              currentUserId = null;
            }
          })
          .catch(() => {});
      }
    };
  }, [userId, queryClient]);
}
