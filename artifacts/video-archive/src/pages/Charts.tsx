import { useState } from "react";
import { Link } from "wouter";
import { useListRecordings, useListPerformers, useGetStats } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/formatters";
import { TrendingUp, Users, HardDrive, Film, Trophy, Star, Flame } from "lucide-react";

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

  const { data: popularData, isLoading: popularLoading } = useListRecordings({
    limit: 24,
    sort: "popular",
  });

  const { data: largestData, isLoading: largestLoading } = useListRecordings({
    limit: 24,
    sort: "largest",
  });

  const { data: performers, isLoading: performersLoading } = useListPerformers();
  const { data: stats } = useGetStats();

  const tabs: { id: ChartTab; label: string; Icon: typeof TrendingUp }[] = [
    { id: "popular", label: "Most Popular", Icon: Flame },
    { id: "largest", label: "Biggest Files", Icon: HardDrive },
    { id: "performers", label: "Top Performers", Icon: Trophy },
  ];

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
              { label: "Recordings", value: (stats.total_recordings ?? 0).toLocaleString(), Icon: Film },
              { label: "Performers", value: (stats.total_performers ?? 0).toLocaleString(), Icon: Users },
              { label: "Tags", value: (stats.total_tags ?? 0).toLocaleString(), Icon: TrendingUp },
              { label: "Total Size", value: formatBytes(stats.total_size_bytes ?? 0), Icon: HardDrive },
            ].map(({ label, value, Icon }) => (
              <div key={label} className="border border-border/50 rounded-sm px-4 py-3 flex items-center gap-3">
                <Icon className="w-4 h-4 text-primary/60 shrink-0" />
                <div>
                  <div className="text-sm font-bold">{value}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
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
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                tab === id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Performers leaderboard */}
        {tab === "performers" && (
          <div className="space-y-2">
            {performersLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 border border-border/30 rounded-sm">
                    <Skeleton className="w-8 h-8 rounded-sm" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </div>
                ))
              : performers
                  ?.slice(0, 50)
                  .sort((a, b) => b.recording_count - a.recording_count)
                  .map((p, i) => (
                    <Link key={p.username} href={`/performers/${p.username}`}>
                      <div className="flex items-center gap-4 p-3 border border-border/30 hover:border-primary/30 hover:bg-secondary/30 rounded-sm transition-all group cursor-pointer">
                        <div
                          className={`w-8 h-8 flex items-center justify-center rounded-sm text-xs font-black shrink-0 ${
                            i === 0
                              ? "bg-yellow-500/20 text-yellow-500"
                              : i === 1
                              ? "bg-slate-400/20 text-slate-400"
                              : i === 2
                              ? "bg-orange-600/20 text-orange-600"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {i + 1}
                        </div>
                        {p.latest_thumbnail ? (
                          <img
                            src={p.latest_thumbnail}
                            alt={p.username}
                            className="w-10 h-10 object-cover rounded-sm shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-secondary rounded-sm shrink-0 flex items-center justify-center">
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
                          <div className="text-sm font-bold text-foreground">{p.recording_count}</div>
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
                    <div key={rec.id} className="relative">
                      <div
                        className={`absolute -top-2 -left-2 z-10 w-7 h-7 flex items-center justify-center rounded-full text-[11px] font-black shadow-md ${
                          i === 0
                            ? "bg-yellow-500 text-black"
                            : i === 1
                            ? "bg-slate-400 text-black"
                            : "bg-orange-600 text-white"
                        }`}
                      >
                        {i + 1}
                      </div>
                      <VideoCard recording={rec} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rest of the list */}
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
              #{recordings && recordings.length > 3 ? "4" : "1"} and beyond
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {loading
                ? Array.from({ length: 18 }).map((_, i) => <VideoSkeleton key={i} />)
                : recordings?.slice(3).map((rec) => <VideoCard key={rec.id} recording={rec} />)}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
