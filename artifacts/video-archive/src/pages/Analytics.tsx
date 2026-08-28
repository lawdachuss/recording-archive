import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { userApi } from "@/lib/user-api";
import { Link } from "wouter";
import {
  BarChart3, Clock, Film, CheckCircle, TrendingUp,
  ArrowLeft, Loader2, Users
} from "lucide-react";

function formatMs(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Analytics() {
  const { user } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["user", "history", "stats"],
    queryFn: () => userApi.getWatchStats(),
    enabled: !!user,
    staleTime: 60_000,
  });

  if (!user) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground mb-4">Sign in to view your watch analytics.</p>
            <Link href="/login" className="text-sm text-primary hover:underline">Sign in →</Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8 pb-6 border-b border-border/40">
          <Link href="/history" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="w-3 h-3" /> Back to History
          </Link>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
            Analytics
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Watch Analytics</h1>
          <p className="text-sm text-muted-foreground mt-2">Your viewing habits at a glance</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 text-primary/60 animate-spin" />
          </div>
        ) : !stats ? (
          <div className="py-24 text-center">
            <p className="text-muted-foreground">No data available yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                icon={<Clock className="w-4 h-4" />}
                label="Total Watch Time"
                value={formatMs(stats.totalWatchMs)}
                color="text-blue-400"
              />
              <StatCard
                icon={<Film className="w-4 h-4" />}
                label="Videos Watched"
                value={String(stats.totalVideos)}
                color="text-violet-400"
              />
              <StatCard
                icon={<CheckCircle className="w-4 h-4" />}
                label="Completed"
                value={`${stats.completedVideos}`}
                sub={stats.totalVideos > 0 ? `${Math.round((stats.completedVideos / stats.totalVideos) * 100)}%` : undefined}
                color="text-green-400"
              />
              <StatCard
                icon={<TrendingUp className="w-4 h-4" />}
                label="Avg Progress"
                value={`${stats.avgProgress}%`}
                color="text-amber-400"
              />
            </div>

            {/* Top Performers */}
            {stats.topPerformers.length > 0 && (
              <section className="rounded-xl border border-border/30 bg-card p-5">
                <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  Most Watched Performers
                </h2>
                <div className="space-y-2">
                  {stats.topPerformers.map((p, i) => (
                    <div key={p.username} className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground/50 w-4 text-right tabular-nums">{i + 1}</span>
                      <Link
                        href={`/performer/${p.username}`}
                        className="flex-1 text-sm text-foreground hover:text-primary transition-colors truncate"
                      >
                        @{p.username}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">{p.count} videos</span>
                      <span className="text-[11px] text-muted-foreground/50 tabular-nums">{formatMs(p.watchMs)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Charts row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Watch by day of week */}
              <section className="rounded-xl border border-border/30 bg-card p-5">
                <h2 className="text-sm font-bold mb-4">Watch by Day</h2>
                <div className="flex items-end gap-2 h-32">
                  {DAY_LABELS.map((label, i) => {
                    const max = Math.max(...stats.dayBuckets, 1);
                    const height = (stats.dayBuckets[i] / max) * 100;
                    return (
                      <div key={label} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full rounded-t-sm bg-primary/30 relative" style={{ height: `${Math.max(height, 2)}%` }}>
                          <div className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-primary/70" style={{ height: `${height}%` }} />
                        </div>
                        <span className="text-[9px] text-muted-foreground/60">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Watch by hour */}
              <section className="rounded-xl border border-border/30 bg-card p-5">
                <h2 className="text-sm font-bold mb-4">Watch by Hour</h2>
                <div className="flex items-end gap-[2px] h-32">
                  {stats.hourBuckets.map((val, i) => {
                    const max = Math.max(...stats.hourBuckets, 1);
                    const height = (val / max) * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center">
                        <div className="w-full rounded-t-sm bg-violet-500/30 relative" style={{ height: `${Math.max(height, 2)}%` }}>
                          <div className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-violet-500/70" style={{ height: `${height}%` }} />
                        </div>
                        {i % 6 === 0 && <span className="text-[8px] text-muted-foreground/60 mt-1">{i}h</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-card p-4">
      <div className={`w-8 h-8 rounded-lg bg-secondary/50 flex items-center justify-center mb-3 ${color}`}>
        {icon}
      </div>
      <p className="text-2xl font-black tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
      <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
