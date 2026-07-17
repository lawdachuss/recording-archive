import { useQuery } from "@tanstack/react-query";
import { userApi } from "@/lib/user-api";
import { useAuth } from "@/contexts/AuthContext";
import { getWatchedIds } from "@/lib/watched-storage";

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

  const localWatched = getWatchedIds();

  // Merge local and server sets
  if (serverSet && serverSet.size > 0) {
    const merged = new Set(localWatched);
    for (const id of serverSet) merged.add(id);
    return merged;
  }

  return localWatched;
}
