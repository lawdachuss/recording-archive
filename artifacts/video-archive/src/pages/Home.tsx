import {
  useGetStats,
  useListRecordings,
  useListTags,
  getGetStatsQueryKey,
  getListRecordingsQueryKey,
  getListTagsQueryKey,
} from "@workspace/api-client-react";
import { useListPerformers, useListRecommendations } from "@/lib/api";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { PerformerCard } from "@/components/PerformerCard";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";
import { useState, useEffect, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, type PerformerFollow } from "@/lib/user-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { Search, ArrowRight, TrendingUp, Star, Clock, Heart, Bookmark, ThumbsUp, Users, Tags, Clapperboard } from "lucide-react";

type Tab = "recent" | "popular";

function VideoSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="w-full aspect-video rounded-sm" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

interface ActivityEvent {
  id: string;
  type: "bookmark" | "history" | "follow" | "like";
  label: string;
  subtitle: string;
  href: string;
  timestamp: string;
}

export default function Home() {
  const [_, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("recent");
  const { user } = useAuth();

  const { data: stats } = useGetStats({ query: { queryKey: getGetStatsQueryKey(), staleTime: 30_000 } });

  // ─── Activity feed ────────────────────────────────────
  const { data: savedItems = [] } = useQuery({
    queryKey: ["user", "saved"],
    queryFn: () => userApi.getSaved(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: historyItems = [] } = useQuery({
    queryKey: ["user", "history"],
    queryFn: () => userApi.getHistory(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: follows = [] } = useQuery({
    queryKey: ["user", "follows"],
    queryFn: () => userApi.getFollows(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const recentActivity = useMemo(() => {
    if (!user) return [];
    const events: ActivityEvent[] = [];

    // Recent bookmarks (up to 5)
    for (const item of savedItems.slice(0, 5)) {
      const rec = parseCloudItem(item);
      events.push({
        id: `bookmark-${item.recording_id}`,
        type: "bookmark",
        label: rec.username || item.recording_id,
        subtitle: "Saved to bookmarks",
        href: `/video/${item.recording_id}`,
        timestamp: item.saved_at ?? new Date().toISOString(),
      });
    }

    // Recent history (up to 5)
    for (const item of historyItems.slice(0, 5)) {
      const rec = parseCloudItem(item);
      events.push({
        id: `history-${item.recording_id}`,
        type: "history",
        label: rec.username || item.recording_id,
        subtitle: "Watched recently",
        href: `/video/${item.recording_id}`,
        timestamp: item.watched_at ?? item.added_at ?? new Date().toISOString(),
      });
    }

    // Recent follows (up to 5)
    for (const f of (follows as PerformerFollow[]).slice(0, 5)) {
      events.push({
        id: `follow-${f.performer_username}`,
        type: "follow",
        label: f.performer_username,
        subtitle: "Started following",
        href: `/performers/${f.performer_username}`,
        timestamp: f.followed_at,
      });
    }

    // Sort by most recent first, limit to 8
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8);
  }, [user, savedItems, historyItems, follows]);

  const ACTIVITY_ICONS: Record<ActivityEvent["type"], typeof Heart> = {
    bookmark: Bookmark,
    history: Clock,
    follow: Heart,
    like: ThumbsUp,
  };

  const ACTIVITY_COLORS: Record<ActivityEvent["type"], string> = {
    bookmark: "text-amber-500",
    history: "text-blue-400",
    follow: "text-pink-500",
    like: "text-green-500",
  };
  const recentParams = { limit: 24, sort: "newest" as const };
  const { data: recentData, isLoading: recentLoading } = useListRecordings(
    recentParams,
    { query: { queryKey: getListRecordingsQueryKey(recentParams), staleTime: 30_000, placeholderData: keepPreviousData } },
  );
  const popularParams = { limit: 24, sort: "popular" as const };
  const { data: popularData, isLoading: popularLoading } = useListRecordings(
    popularParams,
    { query: { queryKey: getListRecordingsQueryKey(popularParams), staleTime: 30_000, placeholderData: keepPreviousData } },
  );
  const recentlyWatched = useRecentlyWatched();
  const excludeIds = recentlyWatched.size > 0 ? [...recentlyWatched].join(",") : undefined;
  const { data: recData, isLoading: recLoading } = useListRecommendations(
    { limit: 8, exclude: excludeIds },
    { enabled: true, placeholderData: keepPreviousData },
  );
  const recommendations = recData?.data ?? [];

  const { data: topPerformersData } = useListPerformers(undefined, { staleTime: 30_000 });
  const topPerformers = topPerformersData?.performers ?? [];
  const { data: tags } = useListTags({ query: { queryKey: getListTagsQueryKey(), staleTime: 30_000 } });

  const recordings = tab === "recent" ? recentData?.data : popularData?.data;
  const loading = tab === "recent" ? recentLoading : popularLoading;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/browse?search=${encodeURIComponent(search.trim())}`);
    } else {
      setLocation("/browse");
    }
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="relative border-b border-border/50 px-4 sm:px-6 py-20 md:py-28 overflow-hidden">
        {/* Diamond texture */}
        <div className="pattern-square absolute inset-0 pointer-events-none opacity-20" aria-hidden="true" />
        <div className="container mx-auto max-w-4xl text-center relative">
          <div className="mb-4 flex items-center gap-3 animate-fade-in-up" style={{ animationDelay: '0ms' }}>
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground font-medium">
              Private Recording Archive
            </span>
            <div className="h-px flex-1 bg-border/50" />
          </div>

          <h1 className="text-[clamp(3.5rem,9vw,7rem)] font-black tracking-tighter leading-none mb-6 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
            VAULT<span className="text-primary">.</span>
          </h1>

          <div className="mb-10 text-xs text-muted-foreground animate-fade-in-up" style={{ animationDelay: '160ms' }}>
            <p className="text-[15px] text-muted-foreground/60 font-light italic tracking-wide">
              Always something to watch.
            </p>
          </div>

          <form onSubmit={handleSearch} className="max-w-xl mx-auto relative animate-fade-in-up" style={{ animationDelay: '240ms' }}>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Search by performer, title, or tag…"
              className="w-full h-12 bg-background dark:bg-card border border-border/60 hover:border-border focus:border-primary/60 rounded-xl pl-11 pr-28 text-sm outline-none transition-all duration-200 placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/10 focus:border-primary/50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search recordings"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 px-4 border border-primary/30 text-primary text-xs font-semibold tracking-wide hover:border-primary/60 transition-all duration-200 rounded-lg"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      {/* Recordings — tabs */}
      <section className="px-4 sm:px-6 py-14 relative overflow-hidden">
        <div className="container mx-auto">
          <div className="flex items-center justify-between mb-8">
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-secondary dark:bg-white/[0.06] border border-border/50 rounded-lg p-0.5">
              <button
                onClick={() => setTab("recent")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                  tab === "recent"
                    ? "border border-primary/60 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Clock className="w-3 h-3" />
                Recent
              </button>
              <button
                onClick={() => setTab("popular")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                  tab === "popular"
                    ? "border border-primary/60 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="w-3 h-3" />
                Popular
              </button>
            </div>

            <Link
              href={`/browse${tab === "popular" ? "?sort=popular" : ""}`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              View all <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
              {Array.from({ length: 24 }).map((_, i) => (
                <VideoSkeleton key={i} />
              ))}
            </div>
          ) : recordings && recordings.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8 animate-fade-in-up">
              {recordings.map((rec, i) => (
                <div key={rec.id}>
                  <VideoCard recording={rec} fetchPriority={i < 2 ? "high" : undefined} isWatched={recentlyWatched.has(rec.id)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center border border-border/40 rounded-xl bg-secondary/10 animate-fade-in-up">
              <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                <Clapperboard className="w-6 h-6 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">No recordings found.</p>
              <p className="text-xs text-muted-foreground/40 mb-5 max-w-xs mx-auto">
                {tab === "recent"
                  ? "New recordings will appear here as they're archived."
                  : "Popular recordings will show here as they gain views."}
              </p>
              <Link
                href="/browse"
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors"
              >
                Browse all recordings →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* You might like these — personalized recommendations */}
      {(recommendations.length > 0 || recLoading) && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14 relative overflow-hidden">
          <div className="pattern-square absolute inset-0 pointer-events-none opacity-20" aria-hidden="true" />
          <div className="container mx-auto relative">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-0.5 h-8 bg-primary/60 rounded-full shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                    <Star className="w-3.5 h-3.5 text-primary" />
                    You might like these
                  </h2>
                  <p className="text-[11px] text-muted-foreground/40 mt-0.5">
                    {user ? "Based on your activity" : "Trending now"}
                  </p>
                </div>
              </div>
            </div>

            {recLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
                {Array.from({ length: 8 }).map((_, i) => (
                  <VideoSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8 animate-fade-in-up">
                {recommendations.map((rec, i) => (
                  <div key={rec.id}>
                    <VideoCard key={rec.id} recording={rec} fetchPriority={i < 2 ? "high" : undefined} isWatched={recentlyWatched.has(rec.id)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Top Performers — Circular avatars */}
      {topPerformers.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14 relative overflow-hidden">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                <Users className="w-3.5 h-3.5 text-primary" />
                Top Performers
              </h2>
              <Link
                href="/performers"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
              >
                Directory <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-y-6 gap-x-2 justify-items-center animate-fade-in-up">
              {topPerformers.slice(0, 20).map((perf, i) => (
                <div key={perf.username}>
                  <PerformerCard performer={perf} variant="circle" fetchPriority={i < 4 ? "high" : undefined} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Activity feed — only for signed-in users */}
      {user && recentActivity.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14 bg-secondary relative overflow-hidden">
          <div className="container mx-auto max-w-lg">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-6">
              <Clock className="w-3.5 h-3.5 text-primary" />
              Recent Activity
            </div>
            <div className="space-y-1">
              {recentActivity.map((event) => {
                const Icon = ACTIVITY_ICONS[event.type];
                const colorClass = ACTIVITY_COLORS[event.type];
                return (
                  <Link key={event.id} href={event.href}>
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-sm hover:bg-background/60 dark:hover:bg-white/5 transition-all group">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${event.type === "history" ? "bg-blue-500/10" : event.type === "bookmark" ? "bg-amber-500/10" : event.type === "follow" ? "bg-pink-500/10" : "bg-green-500/10"}`}>
                        <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                          {event.label}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
                          <span>{event.subtitle}</span>
                          <span>·</span>
                          <span>{formatRelativeTime(event.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Popular Tags */}
      {Array.isArray(tags) && tags.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14 relative overflow-hidden">
          <div className="pattern-square absolute inset-0 pointer-events-none opacity-20" aria-hidden="true" />
          <div className="container mx-auto relative">
            <div className="flex items-center justify-between mb-8">
              <h2 className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                <Tags className="w-3.5 h-3.5 text-primary" />
                Browse by Tag
              </h2>
              <Link
                href="/tags"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
              >
                All tags <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.slice(0, 40).map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded-lg dark:bg-card"
                >
                  {tag}
                  <span className="text-[10px] text-muted-foreground/50 font-medium">{count}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
