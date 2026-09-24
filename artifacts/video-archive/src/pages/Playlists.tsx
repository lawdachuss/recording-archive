import { useMemo, type ComponentType, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useListRecordings,
  useListTags,
  getListRecordingsQueryKey,
  getListTagsQueryKey,
  type Recording,
} from "@workspace/api-client-react";
import { useListPerformers, useListRecommendations } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { AdBanner } from "@/components/ads/AdBanner";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { usePreloadRecordings } from "@/hooks/use-preload-recordings";
import { useAuth } from "@/contexts/AuthContext";
import { userApi } from "@/lib/user-api";
import { getWatchedEntries } from "@/lib/watched-storage";
import { setQueue, shuffleQueueItems, toQueueItem, type QueueItem } from "@/lib/play-queue";
import { trackActivity } from "@/lib/rum";
import {
  ListVideo, Flame, Clock, HardDrive, Star, Tags, Users,
  Play, ArrowRight, Clapperboard, Shuffle, Bookmark,
} from "lucide-react";

function VideoSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="w-full aspect-video rounded-sm" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** One auto-generated mix: a titled shelf of recordings with a Play-all action. */
interface Mix {
  id: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  items?: Recording[] | null;
  loading: boolean;
  viewAll?: string;
}

const MIXES_PER_PAGE = 12;

export default function Playlists() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const recentlyWatched = useRecentlyWatched();

  // ── Mix data ─────────────────────────────────────────────────────
  // Static hook calls with dynamic params (enabled-gated until their
  // tag/performer slot resolves) — React forbids hooks inside loops.
  const trendingParams = { limit: MIXES_PER_PAGE, sort: "popular" as const };
  const { data: trendingData, isLoading: trendingLoading } = useListRecordings(
    trendingParams,
    { query: { queryKey: getListRecordingsQueryKey(trendingParams), staleTime: 60_000 } },
  );

  const newestParams = { limit: MIXES_PER_PAGE, sort: "newest" as const };
  const { data: newestData, isLoading: newestLoading } = useListRecordings(
    newestParams,
    { query: { queryKey: getListRecordingsQueryKey(newestParams), staleTime: 60_000 } },
  );

  const longParams = { limit: MIXES_PER_PAGE, sort: "largest" as const };
  const { data: longData, isLoading: longLoading } = useListRecordings(
    longParams,
    { query: { queryKey: getListRecordingsQueryKey(longParams), staleTime: 60_000 } },
  );

  // Recommendations exclude what the visitor already watched recently. The
  // list is capped at the 50 most-recent entries (watched-storage keeps them
  // sorted newest-first): an unbounded exclude param eventually produces URLs
  // too long for the API or any proxy in front of it.
  const excludeIds = useMemo(() => {
    if (recentlyWatched.size === 0) return undefined;
    const ids = getWatchedEntries()
      .slice(0, 50)
      .map((e) => e.id)
      .filter((id) => recentlyWatched.has(id));
    return ids.length > 0 ? ids.join(",") : undefined;
  }, [recentlyWatched]);

  // Signed-in users get their saved lists surfaced as playable playlists too.
  const { data: collections } = useQuery({
    queryKey: ["user", "collections"],
    queryFn: () => userApi.getCollections(),
    enabled: !!user,
    staleTime: 30_000,
  });
  const { data: recData, isLoading: recLoading } = useListRecommendations(
    { limit: MIXES_PER_PAGE, exclude: excludeIds },
    { staleTime: 30_000 },
  );

  const { data: tagCounts } = useListTags({
    query: { queryKey: getListTagsQueryKey(), staleTime: 60_000 },
  });
  const t0 = tagCounts?.[0];
  const t1 = tagCounts?.[1];
  const t2 = tagCounts?.[2];

  const tagMix0Params = { limit: MIXES_PER_PAGE, tags: t0?.tag ?? "" };
  const tagMix0 = useListRecordings(tagMix0Params, {
    query: { enabled: !!t0, queryKey: getListRecordingsQueryKey(tagMix0Params), staleTime: 60_000 },
  });
  const tagMix1Params = { limit: MIXES_PER_PAGE, tags: t1?.tag ?? "" };
  const tagMix1 = useListRecordings(tagMix1Params, {
    query: { enabled: !!t1, queryKey: getListRecordingsQueryKey(tagMix1Params), staleTime: 60_000 },
  });
  const tagMix2Params = { limit: MIXES_PER_PAGE, tags: t2?.tag ?? "" };
  const tagMix2 = useListRecordings(tagMix2Params, {
    query: { enabled: !!t2, queryKey: getListRecordingsQueryKey(tagMix2Params), staleTime: 60_000 },
  });

  const { data: performersData } = useListPerformers(undefined, { staleTime: 60_000 });
  const topPerformers = performersData?.performers ?? [];
  const p0 = topPerformers[0];
  const p1 = topPerformers[1];
  const p2 = topPerformers[2];

  const perfMix0Params = { limit: MIXES_PER_PAGE, username: p0?.username ?? "", sort: "newest" as const };
  const perfMix0 = useListRecordings(perfMix0Params, {
    query: { enabled: !!p0, queryKey: getListRecordingsQueryKey(perfMix0Params), staleTime: 60_000 },
  });
  const perfMix1Params = { limit: MIXES_PER_PAGE, username: p1?.username ?? "", sort: "newest" as const };
  const perfMix1 = useListRecordings(perfMix1Params, {
    query: { enabled: !!p1, queryKey: getListRecordingsQueryKey(perfMix1Params), staleTime: 60_000 },
  });
  const perfMix2Params = { limit: MIXES_PER_PAGE, username: p2?.username ?? "", sort: "newest" as const };
  const perfMix2 = useListRecordings(perfMix2Params, {
    query: { enabled: !!p2, queryKey: getListRecordingsQueryKey(perfMix2Params), staleTime: 60_000 },
  });

  // Warm hover media for the two above-the-fold mixes only — the rest is
  // warmed by the viewport prefetcher as the visitor scrolls.
  usePreloadRecordings(trendingData?.data);
  usePreloadRecordings(newestData?.data);

  const mixes: Mix[] = [
    {
      id: "trending",
      title: "Trending Now",
      subtitle: "Most watched across the archive",
      icon: Flame,
      items: trendingData?.data,
      loading: trendingLoading,
      viewAll: "/browse?sort=popular",
    },
    {
      id: "newest",
      title: "Just Added",
      subtitle: "The latest recordings to land",
      icon: Clock,
      items: newestData?.data,
      loading: newestLoading,
      viewAll: "/browse",
    },
    {
      id: "long-sessions",
      title: "Long Sessions",
      subtitle: "Big files for a slow evening",
      icon: HardDrive,
      items: longData?.data,
      loading: longLoading,
      viewAll: "/browse?sort=largest",
    },
    {
      id: "for-you",
      title: "Picked For You",
      subtitle: user ? "Based on what you've been watching" : "A bit of everything, fresh every visit",
      icon: Star,
      items: recData?.data,
      loading: recLoading,
      viewAll: "/browse",
    },
    ...(t0
      ? [{
          id: `tag:${t0.tag}`,
          title: `#${t0.tag}`,
          subtitle: `${t0.count.toLocaleString()} recordings`,
          icon: Tags,
          items: tagMix0.data?.data,
          loading: tagMix0.isLoading,
          viewAll: `/browse?tags=${encodeURIComponent(t0.tag)}`,
        } satisfies Mix]
      : []),
    ...(t1
      ? [{
          id: `tag:${t1.tag}`,
          title: `#${t1.tag}`,
          subtitle: `${t1.count.toLocaleString()} recordings`,
          icon: Tags,
          items: tagMix1.data?.data,
          loading: tagMix1.isLoading,
          viewAll: `/browse?tags=${encodeURIComponent(t1.tag)}`,
        } satisfies Mix]
      : []),
    ...(t2
      ? [{
          id: `tag:${t2.tag}`,
          title: `#${t2.tag}`,
          subtitle: `${t2.count.toLocaleString()} recordings`,
          icon: Tags,
          items: tagMix2.data?.data,
          loading: tagMix2.isLoading,
          viewAll: `/browse?tags=${encodeURIComponent(t2.tag)}`,
        } satisfies Mix]
      : []),
    ...(p0
      ? [{
          id: `performer:${p0.username}`,
          title: p0.username,
          subtitle: `${p0.recording_count.toLocaleString()} recordings · newest first`,
          icon: Users,
          items: perfMix0.data?.data,
          loading: perfMix0.isLoading,
          viewAll: `/performers/${encodeURIComponent(p0.username)}`,
        } satisfies Mix]
      : []),
    ...(p1
      ? [{
          id: `performer:${p1.username}`,
          title: p1.username,
          subtitle: `${p1.recording_count.toLocaleString()} recordings · newest first`,
          icon: Users,
          items: perfMix1.data?.data,
          loading: perfMix1.isLoading,
          viewAll: `/performers/${encodeURIComponent(p1.username)}`,
        } satisfies Mix]
      : []),
    ...(p2
      ? [{
          id: `performer:${p2.username}`,
          title: p2.username,
          subtitle: `${p2.recording_count.toLocaleString()} recordings · newest first`,
          icon: Users,
          items: perfMix2.data?.data,
          loading: perfMix2.isLoading,
          viewAll: `/performers/${encodeURIComponent(p2.username)}`,
        } satisfies Mix]
      : []),
  ];

  // ── Queue actions ────────────────────────────────────────────────
  /** Usable queue items for a mix (invalid shapes dropped) — null when empty. */
  const mixItems = (mix: Mix): QueueItem[] | null => {
    const items = (mix.items ?? []).map(toQueueItem).filter((it): it is QueueItem => it !== null);
    return items.length > 0 ? items : null;
  };

  /**
   * Card click: seed the whole mix so the queue continues from wherever the
   * visitor landed. Returns the seeded items — handlePlayAll navigates to
   * items[0] from this (never the raw first recording, which could differ
   * once invalid items are dropped).
   */
  const seedQueue = (mix: Mix, startIndex: number): QueueItem[] | null => {
    const items = mixItems(mix);
    if (!items) return null;
    setQueue(mix.title, items);
    // Analytics: a playlist/queue was started from the Playlists page.
    trackActivity("playlist_start", {
      meta: { mix: mix.id, count: items.length, index: startIndex, order: "sequential" },
    });
    return items;
  };

  /** Play-all: queue the whole mix and jump to its first queued recording. */
  const handlePlayAll = (mix: Mix) => {
    const items = seedQueue(mix, 0);
    if (!items) return;
    window.scrollTo({ top: 0, behavior: "auto" });
    setLocation(`/video/${items[0].id}`);
  };

  /** Shuffle: random start, shuffled order after it (the whole mix still plays). */
  const handleShuffle = (mix: Mix) => {
    const items = mixItems(mix);
    if (!items) return;
    const startId = items[Math.floor(Math.random() * items.length)].id;
    const shuffled = shuffleQueueItems(items, startId);
    setQueue(mix.title, shuffled);
    trackActivity("playlist_start", {
      meta: { mix: mix.id, count: shuffled.length, index: 0, order: "shuffle" },
    });
    window.scrollTo({ top: 0, behavior: "auto" });
    setLocation(`/video/${shuffled[0].id}`);
  };

  /** Guard for card click-capture: only plain left-clicks seed the queue —
   * modifier combos (new tab/window) navigate elsewhere and must not hijack
   * the session queue for a video the user isn't opening here. */
  const plainClick = (e: MouseEvent) =>
    !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

  const loadingAny = mixes.some((m) => m.loading);
  const totalItems = mixes.reduce((n, m) => n + (m.items?.length ?? 0), 0);

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <ListVideo className="w-3.5 h-3.5 text-primary" />
            Playlists
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Playlists</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Curated mixes built from the archive — press play and let it roll.
          </p>
        </div>

        {/* Top ad — 728×90 / 468×60 / 300×100 */}
        <AdLeaderboard className="mb-8" />

        {/* Nothing at all (every mix empty and settled) */}
        {!loadingAny && totalItems === 0 && (
          <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Clapperboard className="w-6 h-6 text-muted-foreground/20" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">No mixes to show yet.</p>
            <p className="text-xs text-muted-foreground/40">
              Playlists build themselves from the archive as recordings land.
            </p>
          </div>
        )}

        {/* Your playlists — saved collections + Watch Later (signed-in only) */}
        {user && (
          <section className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg border border-primary/25 flex items-center justify-center shrink-0">
                <Bookmark className="w-4 h-4 text-primary/80" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-tight">Your playlists</h2>
                <p className="text-[11px] text-muted-foreground">Saved lists you can play end-to-end</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <Link
                href="/watch-later"
                className="group flex items-center gap-3 p-3.5 border border-border/40 hover:border-primary/40 rounded-lg bg-background/40 transition-colors animate-fade-in-up"
              >
                <div className="w-9 h-9 rounded-md bg-secondary/60 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">Watch Later</p>
                  <p className="text-[10px] text-muted-foreground/60">Your saved queue</p>
                </div>
              </Link>
              {(collections ?? []).map((col) => (
                <Link
                  key={col.id}
                  href={`/collections/${col.id}`}
                  className="group flex items-center gap-3 p-3.5 border border-border/40 hover:border-primary/40 rounded-lg bg-background/40 transition-colors animate-fade-in-up"
                >
                  <div className="w-9 h-9 rounded-md bg-secondary/60 flex items-center justify-center shrink-0">
                    <ListVideo className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{col.name}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {col.item_count ?? 0} recording{(col.item_count ?? 0) !== 1 ? "s" : ""}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Mix shelves */}
        {mixes.map((mix) => {
          if (!mix.loading && !(mix.items && mix.items.length > 0)) return null;
          const MixIcon = mix.icon;
          return (
            <section key={mix.id} className="mb-10 last:mb-0">
              <div className="flex items-end justify-between gap-4 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg border border-primary/25 flex items-center justify-center shrink-0">
                    <MixIcon className="w-4 h-4 text-primary/80" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold tracking-tight truncate">{mix.title}</h2>
                    <p className="text-[11px] text-muted-foreground truncate">{mix.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {mix.viewAll && !mix.loading && (mix.items?.length ?? 0) > 0 && (
                    <Link
                      href={mix.viewAll}
                      className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      View all
                      <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </Link>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleShuffle(mix)}
                      disabled={mix.loading || (mix.items?.length ?? 0) === 0}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium border border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors rounded-md disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                      title="Shuffle play"
                      aria-label={`Shuffle play ${mix.title}`}
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">Shuffle</span>
                    </button>
                    <button
                      onClick={() => handlePlayAll(mix)}
                      disabled={mix.loading || (mix.items?.length ?? 0) === 0}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-md disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Play all
                    </button>
                  </div>
                </div>
              </div>

              {mix.loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <VideoSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4 animate-fade-in-up">
                  {(mix.items ?? []).map((rec, i) => (
                    <div
                      key={rec.id}
                      // Clicking any card queues the whole mix from that position,
                      // so the QueueBar continues the shelf wherever they start.
                      // Modifier-clicks (new tab/window) must not hijack the queue.
                      onClickCapture={(e) => {
                        if (plainClick(e)) seedQueue(mix, i);
                      }}
                    >
                      <VideoCard
                        recording={rec}
                        isWatched={recentlyWatched.has(rec.id)}
                        fetchPriority={mix.id === "trending" && i < 6 ? "high" : undefined}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Bottom ad — 300×250 medium rectangle */}
        <div className="mt-10 flex justify-center">
          <AdBanner file="medium-rect-300x250" />
        </div>
      </div>
    </Layout>
  );
}
