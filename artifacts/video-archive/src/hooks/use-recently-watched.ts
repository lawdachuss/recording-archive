import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { userApi } from "@/lib/user-api";
import { useAuth } from "@/contexts/AuthContext";
import { getWatchedIds, WATCHED_CHANGED_EVENT } from "@/lib/watched-storage";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function useRecentlyWatched(): Set<string> {
  const { user } = useAuth();

  const { data: serverSet } = useQuery({
    queryKey: ["user", "history"],
    queryFn: () => userApi.getHistory(),
    enabled: !!user,
    staleTime: 30_000,
    select: (items) => {
      const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
      return new Set(
        items
          .filter((item) => {
            const watchedAt = item.watched_at
              ? new Date(item.watched_at).getTime()
              : 0;
            return watchedAt > cutoff;
          })
          .map((item) => item.recording_id),
      );
    },
  });

  // Re-read local watched IDs from localStorage whenever addWatchedId
  // dispatches the custom event. The initial read + event-driven updates
  // keep the badge in sync without polling.
  const [localVersion, setLocalVersion] = useState(0);
  useEffect(() => {
    const handler = () => setLocalVersion((v) => v + 1);
    window.addEventListener(WATCHED_CHANGED_EVENT, handler);
    // Also listen for cross-tab changes via the native storage event
    const onStorage = (e: StorageEvent) => {
      if (e.key === "vault_watched") handler();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(WATCHED_CHANGED_EVENT, handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const localWatched = useMemo(() => getWatchedIds(), [localVersion]);

  // Merge local and server sets — memoized to avoid creating a new Set
  // reference on every render, which would trigger downstream re-renders.
  return useMemo(() => {
    if (serverSet && serverSet.size > 0) {
      const merged = new Set(localWatched);
      for (const id of serverSet) merged.add(id);
      return merged;
    }
    return localWatched;
  }, [serverSet, localWatched]);
}
