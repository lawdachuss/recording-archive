import {
  useGetStats,
  useListRecordings,
  useListTags,
} from "@workspace/api-client-react";
import { useListPerformers } from "@/lib/api";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { PerformerCard } from "@/components/PerformerCard";
import { formatBytes } from "@/lib/formatters";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowRight, TrendingUp, Clock } from "lucide-react";

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

export default function Home() {
  const [_, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("recent");

  const { data: stats } = useGetStats({ query: { staleTime: 0 } } as any);
  const { data: recentData, isLoading: recentLoading } = useListRecordings(
    { limit: 12, sort: "newest" },
    { query: { staleTime: 0 } } as any,
  );
  const { data: popularData, isLoading: popularLoading } = useListRecordings(
    { limit: 12, sort: "popular" },
    { query: { staleTime: 0 } } as any,
  );
  const { data: topPerformersData } = useListPerformers(undefined, { staleTime: 0 });
  const topPerformers = topPerformersData?.performers ?? [];
  const { data: tags } = useListTags({ query: { staleTime: 0 } } as any);

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
      <section className="border-b border-border/50 px-4 sm:px-6 py-20 md:py-28">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground font-medium">
              Private Recording Archive
            </span>
            <div className="h-px flex-1 bg-border/50" />
          </div>

          <h1 className="text-[clamp(3.5rem,9vw,7rem)] font-black tracking-tighter leading-none mb-6">
            VAULT<span className="text-primary">.</span>
          </h1>

          {stats ? (
            <div className="flex items-center justify-center gap-6 mb-10 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground font-bold text-sm">
                  {stats.total_recordings?.toLocaleString()}
                </strong>{" "}
                recordings
              </span>
              <span className="w-px h-3 bg-border" />
              <span>
                <strong className="text-foreground font-bold text-sm">
                  {stats.total_performers?.toLocaleString()}
                </strong>{" "}
                performers
              </span>
              <span className="w-px h-3 bg-border" />
              <span>
                <strong className="text-foreground font-bold text-sm">
                  {formatBytes(stats.total_size_bytes)}
                </strong>{" "}
                archived
              </span>
            </div>
          ) : (
            <div className="h-10 mb-10" />
          )}

          <form onSubmit={handleSearch} className="max-w-xl mx-auto relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Search by performer, title, or tag…"
              className="w-full h-12 bg-background/80 dark:bg-secondary/60 border border-border/60 hover:border-border focus:border-primary/60 rounded pl-11 pr-28 text-sm outline-none transition-colors placeholder:text-muted-foreground/40"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search recordings"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 px-4 bg-primary text-white text-xs font-semibold tracking-wide hover:bg-primary/90 transition-colors rounded-sm"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      {/* Recordings — tabs */}
      <section className="px-4 sm:px-6 py-14">
        <div className="container mx-auto">
          <div className="flex items-center justify-between mb-8">
            {/* Tabs */}
            <div className="flex items-center gap-1 border border-border/50 rounded p-0.5">
              <button
                onClick={() => setTab("recent")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[2px] transition-colors ${
                  tab === "recent"
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Clock className="w-3 h-3" />
                Recent
              </button>
              <button
                onClick={() => setTab("popular")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[2px] transition-colors ${
                  tab === "popular"
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="w-3 h-3" />
                Popular
              </button>
            </div>

            <Link
              href={`/browse${tab === "popular" ? "?sort=popular" : ""}`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-8">
              {Array.from({ length: 12 }).map((_, i) => (
                <VideoSkeleton key={i} />
              ))}
            </div>
          ) : recordings && recordings.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-8">
              {recordings.map((rec, i) => (
                <VideoCard key={rec.id} recording={rec} fetchPriority={i < 2 ? "high" : undefined} />
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-sm text-muted-foreground border border-border/40 rounded">
              No recordings found.
            </div>
          )}
        </div>
      </section>

      {/* Top Performers — Circular avatars */}
      {topPerformers.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14 bg-secondary/20">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                Top Performers
              </h2>
              <Link
                href="/performers"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Directory <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-y-6 gap-x-2 justify-items-center">
              {topPerformers.slice(0, 20).map((perf, i) => (
                <PerformerCard key={perf.username} performer={perf} variant="circle" fetchPriority={i < 4 ? "high" : undefined} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Popular Tags */}
      {Array.isArray(tags) && tags.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                Browse by Tag
              </h2>
              <Link
                href="/tags"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                All tags <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.slice(0, 40).map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded-sm dark:bg-background/40"
                >
                  {tag}
                  <span className="text-[10px] opacity-40">{count}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
