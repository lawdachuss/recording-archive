import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Layout } from "@/components/Layout";
import { getWatchedIds } from "@/lib/watched-storage";
import { userApi } from "@/lib/user-api";
import { resolveApiPath } from "@/lib/api-base";
import { Loader2 } from "lucide-react";

export default function RandomRedirect() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;

    async function fetchRandom() {
      try {
        // Collect IDs to exclude: local watched + server history (last 24h)
        const excludeIds: string[] = [...getWatchedIds()];

        if (user) {
          try {
            const items = await userApi.getHistory();
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            for (const item of items) {
              const watchedAt = item.watched_at
                ? new Date(item.watched_at).getTime()
                : 0;
              if (watchedAt > cutoff && item.recording_id) {
                excludeIds.push(item.recording_id);
              }
            }
          } catch {
            // Non-critical — use local-only exclusions
          }
        }

        // Deduplicate and cap at 50 IDs to avoid exceeding URL length limits.
        // The server picks random from non-excluded, so capping is fine —
        // it just means recently-watched videos might occasionally reappear.
        const uniqueExclude = [...new Set(excludeIds)].slice(0, 50);

        const base = resolveApiPath("/api/recordings/random");
        const qs = uniqueExclude.length > 0
          ? `?exclude=${encodeURIComponent(uniqueExclude.join(","))}`
          : "";
        const res = await fetch(`${base}${qs}`);

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          if (data?.id) {
            setLocation(`/video/${data.id}`);
            return;
          }
        }
      } catch {
        // fallback below
      }
      if (!cancelled) setLocation("/browse");
    }

    fetchRandom();

    return () => { cancelled = true; };
  }, [user, setLocation]);

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary/40 animate-spin" />
        <p className="text-sm text-muted-foreground">Finding a random recording…</p>
      </div>
    </Layout>
  );
}
