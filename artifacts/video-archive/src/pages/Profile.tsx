import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { AdBanner } from "@/components/ads/AdBanner";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, type PerformerFollow } from "@/lib/user-api";
import { useMyRequests } from "@/lib/api";
import { formatRelativeTime } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import {
  User,
  Clock,
  Bookmark,
  Heart,
  Settings,
  Send,
  ListVideo,
  Shield,
  Activity,
  ArrowRight,
  ExternalLink,
  Film,
  Sparkles,
} from "lucide-react";

interface ActivityEvent {
  id: string;
  type: "bookmark" | "history" | "follow";
  label: string;
  subtitle: string;
  href: string;
  timestamp: string;
}

const ACTIVITY_ICONS = {
  bookmark: Bookmark,
  history: Clock,
  follow: Heart,
};

const ACTIVITY_COLORS = {
  bookmark: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  history: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  follow: "text-pink-500 bg-pink-500/10 border-pink-500/20",
};

const ACTIVITY_LABELS = {
  bookmark: "Bookmark",
  history: "Watched",
  follow: "Following",
};

export default function Profile() {
  const { user, role, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<"all" | "history" | "bookmark" | "follow">("all");

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["user", "profile"],
    queryFn: () => userApi.getProfile(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: savedItems = [], isLoading: savedLoading } = useQuery({
    queryKey: ["user", "saved"],
    queryFn: () => userApi.getSaved(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: historyItems = [], isLoading: historyLoading } = useQuery({
    queryKey: ["user", "history"],
    queryFn: () => userApi.getHistory(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: follows = [], isLoading: followsLoading } = useQuery({
    queryKey: ["user", "follows"],
    queryFn: () => userApi.getFollows(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: watchLaterItems = [] } = useQuery({
    queryKey: ["user", "watch-later"],
    queryFn: () => userApi.getWatchLater(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: requests = [] } = useMyRequests({ enabled: !!user });

  const recentActivity = useMemo(() => {
    if (!user) return [];
    const events: ActivityEvent[] = [];

    // Bookmarks (up to 15)
    for (const item of savedItems.slice(0, 15)) {
      const rec = parseCloudItem(item);
      events.push({
        id: `bookmark-${item.recording_id}`,
        type: "bookmark",
        label: rec.username ? `${rec.username} ${rec.room_title ? `— ${rec.room_title}` : ""}` : item.recording_id,
        subtitle: "Saved to bookmarks",
        href: `/video/${item.recording_id}`,
        timestamp: item.saved_at ?? new Date().toISOString(),
      });
    }

    // History (up to 15)
    for (const item of historyItems.slice(0, 15)) {
      const rec = parseCloudItem(item);
      events.push({
        id: `history-${item.recording_id}`,
        type: "history",
        label: rec.username ? `${rec.username} ${rec.room_title ? `— ${rec.room_title}` : ""}` : item.recording_id,
        subtitle: "Watched recording",
        href: `/video/${item.recording_id}`,
        timestamp: item.watched_at ?? item.added_at ?? new Date().toISOString(),
      });
    }

    // Follows (up to 15)
    for (const f of (follows as PerformerFollow[]).slice(0, 15)) {
      events.push({
        id: `follow-${f.performer_username}`,
        type: "follow",
        label: f.performer_username,
        subtitle: "Started following model",
        href: `/performers/${f.performer_username}`,
        timestamp: f.followed_at,
      });
    }

    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [user, savedItems, historyItems, follows]);

  const filteredActivity = useMemo(() => {
    if (filter === "all") return recentActivity;
    return recentActivity.filter((e) => e.type === filter);
  }, [recentActivity, filter]);

  if (authLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-12 max-w-4xl space-y-6">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </Layout>
    );
  }

  if (!user) {
    setLocation("/login");
    return null;
  }

  const displayName = profile?.display_name || (user.user_metadata?.username as string) || user.email?.split("@")[0] || "Account";
  const initials = displayName.slice(0, 2).toUpperCase();
  const avatarUrl = profile?.avatar_url || (user.user_metadata?.avatar_url as string);

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        {/* Profile Card Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-b from-card via-card to-background p-6 sm:p-8 mb-8 shadow-sm">
          <div className="pattern-square absolute inset-0 pointer-events-none opacity-20" aria-hidden="true" />

          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex items-center gap-4 sm:gap-5 min-w-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2 border-primary/30 shadow-md shrink-0"
                />
              ) : (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-primary/40 bg-primary/10 flex items-center justify-center text-xl sm:text-2xl font-black text-primary shrink-0 shadow-inner">
                  {initials}
                </div>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground truncate">
                    {displayName}
                  </h1>
                  {role && role !== "user" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/30">
                      <Shield className="w-3 h-3" />
                      {role}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium text-muted-foreground bg-secondary border border-border/50">
                      Member
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                {profile?.bio && (
                  <p className="text-xs text-foreground/80 mt-2 max-w-lg line-clamp-2 italic">
                    "{profile.bio}"
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-start sm:self-center shrink-0">
              <Link href="/settings">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg border border-border/60 hover:border-primary/50 hover:text-primary bg-secondary/50 hover:bg-secondary transition-all"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Account Settings
                </button>
              </Link>
            </div>
          </div>
        </div>

        {/* Top ad — 728×90 / 468×60 / 300×100 */}
        <AdLeaderboard className="mb-8" />

        {/* Library Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-8">
          <Link href="/bookmarks">
            <div className="group p-4 rounded-xl border border-border/40 bg-card hover:bg-secondary/40 hover:border-amber-500/30 transition-all cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Bookmarks</span>
                <Bookmark className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-black text-foreground">
                {savedLoading ? <Skeleton className="h-7 w-10 inline-block" /> : savedItems.length}
              </div>
            </div>
          </Link>

          <Link href="/history">
            <div className="group p-4 rounded-xl border border-border/40 bg-card hover:bg-secondary/40 hover:border-blue-500/30 transition-all cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">History</span>
                <Clock className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-black text-foreground">
                {historyLoading ? <Skeleton className="h-7 w-10 inline-block" /> : historyItems.length}
              </div>
            </div>
          </Link>

          <Link href="/following">
            <div className="group p-4 rounded-xl border border-border/40 bg-card hover:bg-secondary/40 hover:border-pink-500/30 transition-all cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Following</span>
                <Heart className="w-4 h-4 text-pink-500 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-black text-foreground">
                {followsLoading ? <Skeleton className="h-7 w-10 inline-block" /> : follows.length}
              </div>
            </div>
          </Link>

          <Link href="/watch-later">
            <div className="group p-4 rounded-xl border border-border/40 bg-card hover:bg-secondary/40 hover:border-primary/30 transition-all cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Watch Later</span>
                <ListVideo className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-black text-foreground">
                {watchLaterItems.length}
              </div>
            </div>
          </Link>

          <Link href="/my-requests">
            <div className="group p-4 rounded-xl border border-border/40 bg-card hover:bg-secondary/40 hover:border-green-500/30 transition-all cursor-pointer col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Requests</span>
                <Send className="w-4 h-4 text-green-500 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-black text-foreground">
                {requests.length}
              </div>
            </div>
          </Link>
        </div>

        {/* Recent Activity Section */}
        <section className="rounded-2xl border border-border/40 bg-card p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-border/30">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Recent Activity</h2>
                <p className="text-xs text-muted-foreground">Your recent playback, saves, and follows</p>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 p-1 bg-secondary/70 rounded-lg border border-border/40 text-xs self-start sm:self-auto overflow-x-auto">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "history", label: "Watched" },
                  { id: "bookmark", label: "Saved" },
                  { id: "follow", label: "Follows" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1 rounded-md font-medium transition-all ${
                    filter === tab.id
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Activity List */}
          <div className="pt-4">
            {savedLoading || historyLoading || followsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30">
                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredActivity.length === 0 ? (
              <div className="text-center py-14 px-4">
                <div className="w-12 h-12 rounded-full bg-secondary/80 flex items-center justify-center mx-auto mb-3 text-muted-foreground">
                  <Activity className="w-6 h-6 opacity-40" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">
                  {filter === "all" ? "No activity recorded yet" : `No ${filter} activity yet`}
                </h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
                  {filter === "all"
                    ? "Watch videos, bookmark your favorite streams, or follow models to build your activity history."
                    : filter === "history"
                    ? "Videos you watch will appear here automatically."
                    : filter === "bookmark"
                    ? "Save videos to your bookmarks to track them here."
                    : "Follow performers from video or profile pages to track their updates."}
                </p>
                <Link href="/browse">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  >
                    <Film className="w-3.5 h-3.5" />
                    Browse recordings
                  </button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border/20">
                {filteredActivity.map((event) => {
                  const Icon = ACTIVITY_ICONS[event.type];
                  const colorClass = ACTIVITY_COLORS[event.type];
                  return (
                    <Link key={event.id} href={event.href}>
                      <div className="flex items-center gap-3.5 py-3 px-2 rounded-lg hover:bg-secondary/40 transition-colors group cursor-pointer">
                        <div
                          className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${colorClass}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate group-hover:text-primary transition-colors text-foreground">
                            {event.label}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{event.subtitle}</span>
                            <span>•</span>
                            <span>{formatRelativeTime(event.timestamp)}</span>
                          </div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Bottom ad — 300×250 medium rectangle */}
        <div className="mt-10 flex justify-center">
          <AdBanner file="medium-rect-300x250" />
        </div>
      </div>
    </Layout>
  );
}
