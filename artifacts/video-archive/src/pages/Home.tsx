import { useGetStats, useListRecordings, useListPerformers, useListTags } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { PerformerCard } from "@/components/PerformerCard";
import { formatBytes } from "@/lib/formatters";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowRight } from "lucide-react";

export default function Home() {
  const [_, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const { data: stats } = useGetStats();
  const { data: recentRecordings, isLoading: recentLoading } = useListRecordings({ limit: 8, sort: "newest" });
  const { data: topPerformers } = useListPerformers();
  const { data: tags } = useListTags();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/browse?search=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="border-b border-border/50 px-4 sm:px-6 py-20 md:py-28">
        <div className="container mx-auto max-w-4xl">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground font-medium">
              Private Recording Archive
            </span>
            <div className="h-px flex-1 bg-border/60" />
          </div>

          <h1 className="text-[clamp(3rem,8vw,6rem)] font-black tracking-tighter leading-none text-center mb-8">
            VAULT
            <span className="text-primary">.</span>
          </h1>

          {stats && (
            <div className="flex items-center justify-center gap-6 mb-10 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground font-semibold">{stats.total_recordings?.toLocaleString()}</strong> recordings
              </span>
              <span className="w-px h-3 bg-border" />
              <span>
                <strong className="text-foreground font-semibold">{stats.total_performers?.toLocaleString()}</strong> performers
              </span>
              <span className="w-px h-3 bg-border" />
              <span>
                <strong className="text-foreground font-semibold">{formatBytes(stats.total_size_bytes)}</strong> archived
              </span>
            </div>
          )}

          <form onSubmit={handleSearch} className="max-w-xl mx-auto relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by performer, title, or tag..."
              className="w-full h-12 bg-secondary/50 border border-border/60 hover:border-border focus:border-primary/60 rounded pl-11 pr-28 text-sm outline-none transition-colors placeholder:text-muted-foreground/50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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

      {/* Recent Recordings */}
      <section className="px-4 sm:px-6 py-14">
        <div className="container mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold">
              Recently Added
            </h2>
            <Link
              href="/browse"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {recentLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="space-y-2.5">
                  <Skeleton className="w-full aspect-video" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
              {recentRecordings?.data.map((rec) => (
                <VideoCard key={rec.id} recording={rec} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Top Performers */}
      {topPerformers && topPerformers.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14 bg-secondary/20">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                Performers
              </h2>
              <Link
                href="/performers"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Directory <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {topPerformers.slice(0, 6).map((perf) => (
                <PerformerCard key={perf.username} performer={perf} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Popular Tags */}
      {tags && tags.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-14">
          <div className="container mx-auto">
            <h2 className="text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-8">
              Browse by Tag
            </h2>
            <div className="flex flex-wrap gap-2">
              {tags.slice(0, 40).map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all"
                >
                  {tag}
                  <span className="text-[10px] opacity-50">{count}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
