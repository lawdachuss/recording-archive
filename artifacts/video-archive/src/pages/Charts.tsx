import { useState } from "react";
import { Link } from "wouter";
import { useListRecordings, useGetStats, getListRecordingsQueryKey, getGetStatsQueryKey } from "@workspace/api-client-react";
import { useListPerformers } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { formatBytes } from "@/lib/formatters";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { TrendingUp, Users, HardDrive, Film, Trophy, Star, Flame, Clapperboard } from "lucide-react";

type ChartTab = "popular" | "largest" | "performers";

function VideoSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="w-full aspect-video rounded-sm" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export default function Charts() {
  const [tab, setTab] = useState<ChartTab>("popular");

  const popularParams = { limit: 24, sort: "popular" as const };
  const { data: popularData, isLoading: popularLoading } = useListRecordings(
    popularParams,
    { query: { queryKey: getListRecordingsQueryKey(popularParams), staleTime: 0 } },
  );

  const largestParams = { limit: 24, sort: "largest" as const };
  const { data: largestData, isLoading: largestLoading } = useListRecordings(
    largestParams,
    { query: { queryKey: getListRecordingsQueryKey(largestParams), staleTime: 0 } },
  );

  const { data: performersData, isLoading: performersLoading } = useListPerformers(undefined, { staleTime: 0 });
  const performers = performersData?.performers ?? [];
  const { data: stats } = useGetStats({ query: { queryKey: getGetStatsQueryKey(), staleTime: 0 } });

  const tabs: { id: ChartTab; label: string; Icon: typeof TrendingUp }[] = [
    { id: "popular", label: "Most Popular", Icon: Flame },
    { id: "largest", label: "Biggest Files", Icon: HardDrive },
    { id: "performers", label: "Top Performers", Icon: Trophy },
  ];

  const recentlyWatched = useRecentlyWatched();

  const recordings = tab === "popular" ? popularData?.data : largestData?.data;
  const loading = tab === "popular" ? popularLoading : largestLoading;

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <Star className="w-3.5 h-3.5 text-primary" />
            Charts
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">
            Top Recordings
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            The best and biggest from the archive
          </p>
        </div>

        {/* Stats strip */}
        {stats && stats.total_recordings != null && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Recordings", value: (stats.total_recordings ?? 0).toLocaleString(), Icon: Film, desc: "In archive" },
              { label: "Performers", value: (stats.total_performers ?? 0).toLocaleString(), Icon: Users, desc: "Unique channels" },
              { label: "Tags", value: (stats.total_tags ?? 0).toLocaleString(), Icon: TrendingUp, desc: "Categories" },
              { label: "Total Size", value: formatBytes(stats.total_size_bytes ?? 0), Icon: HardDrive, desc: "Storage used" },
            ].map(({ label, value, Icon, desc }) => (
              <div key={label} className="group border border-border/50 hover:border-primary/20 hover:bg-primary/[0.02] rounded-lg px-4 py-3.5 flex items-center gap-3 transition-all duration-200">
                <div className="w-9 h-9 rounded-lg border border-primary/20 group-hover:border-primary/40 flex items-center justify-center shrink-0 transition-colors duration-200">
                  <Icon className="w-4 h-4 text-primary/70" />
                </div>
                <div>
                  <div className="text-base font-bold tabular-nums tracking-tight">{value}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                  <div className="text-[9px] text-muted-foreground/30">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-border/40 pb-0">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all duration-200 ${
                tab === id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border/60"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 transition-colors duration-200 ${tab === id ? "text-primary" : ""}`} />
              {label}
            </button>
          ))}
        </div>

        {/* Performers leaderboard */}
        {tab === "performers" && (
          <div className="space-y-1.5">
            {performersLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 border border-border/30 rounded-lg animate-pulse">
                    <div className="w-8 h-8 rounded-lg bg-secondary/60" />
                    <div className="h-4 w-32 rounded bg-secondary/40" />
                    <div className="h-4 w-16 ml-auto rounded bg-secondary/30" />
                  </div>
                ))
              : performers.length === 0 ? (
                <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
                  <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                    <Users className="w-6 h-6 text-muted-foreground/20" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">No performers found yet.</p>
                  <p className="text-xs text-muted-foreground/40">
                    Performers will appear here once recordings are archived.
                  </p>
                </div>
              ) : performers.slice(0, 50).sort((a, b) => b.recording_count - a.recording_count)
                  .map((p, i) => (
                    <Link key={p.username} href={`/performers/${p.username}`}>
                      <div
                        className="flex items-center gap-4 p-3 border border-border/30 hover:border-primary/30 hover:bg-secondary/30 rounded-lg transition-all duration-200 group cursor-pointer animate-fade-in-up"
                        style={{ animationDelay: `${i * 25}ms` }}
                      >
                        <div
                          className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-black shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                            i === 0
                              ? "bg-yellow-500/20 text-yellow-500"
                              : i === 1
                              ? "bg-slate-400/20 text-slate-400"
                              : i === 2
                              ? "bg-orange-600/20 text-orange-600"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                        </div>
                        {p.latest_thumbnail ? (
                          <OptimizedImage
                            src={p.latest_thumbnail}
                            alt={p.username}
                            className="w-10 h-10 object-cover rounded-lg shrink-0"
                            containerClassName="w-10 h-10 rounded-lg shrink-0"
                            fallback={
                              <div className="w-10 h-10 bg-secondary rounded-lg shrink-0 flex items-center justify-center">
                                <Users className="w-4 h-4 text-muted-foreground/30" />
                              </div>
                            }
                          />
                        ) : (
                          <div className="w-10 h-10 bg-secondary rounded-lg shrink-0 flex items-center justify-center">
                            <Users className="w-4 h-4 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold group-hover:text-primary transition-colors truncate">
                            {p.username}
                          </div>
                          {p.gender && (
                            <div className="text-[11px] text-muted-foreground capitalize">{p.gender}</div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold text-foreground tabular-nums">{p.recording_count}</div>
                          <div className="text-[10px] text-muted-foreground">recordings</div>
                        </div>
                      </div>
                    </Link>
                  ))}
          </div>
        )}

        {/* Video grids */}
        {tab !== "performers" && (
          <>
            {/* Ranked top 3 */}
            {!loading && recordings && recordings.length > 0 && (
              <div className="mb-8">
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3 flex items-center gap-1.5">
                  <Trophy className="w-3 h-3" />
                  Top 3
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {recordings.slice(0, 3).map((rec, i) => (
                    <div key={rec.id} className="relative animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
                      <div
                        className={`absolute -top-2 -left-2 z-10 w-7 h-7 flex items-center justify-center rounded-full text-[11px] font-black shadow-lg ${
                          i === 0
                            ? "bg-yellow-500 text-black shadow-yellow-500/30"
                            : i === 1
                            ? "bg-slate-400 text-black shadow-slate-400/30"
                            : "bg-orange-600 text-white shadow-orange-600/30"
                        }`}
                      >
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                      </div>
                      <VideoCard recording={rec} isWatched={recentlyWatched.has(rec.id)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && (!recordings || recordings.length === 0) ? (
              <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
                <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                  <Clapperboard className="w-6 h-6 text-muted-foreground/20" />
                </div>
                <p className="text-sm text-muted-foreground mb-1">
                  {tab === "popular" ? "No popular recordings yet." : "No large recordings yet."}
                </p>
                <p className="text-xs text-muted-foreground/40">
                  {tab === "popular"
                    ? "Popular recordings will appear here as they gain views."
                    : "Large files will appear here once they're archived."}
                </p>
              </div>
            ) : (
              <>
                {/* Rest of the list */}
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
                  #{recordings && recordings.length > 3 ? "4" : "1"} and beyond
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {loading
                    ? Array.from({ length: 18 }).map((_, i) => <VideoSkeleton key={i} />)
                    : recordings?.slice(3).map((rec, i) => <VideoCard key={rec.id} recording={rec} fetchPriority={i < 2 ? "high" : undefined} isWatched={recentlyWatched.has(rec.id)} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
