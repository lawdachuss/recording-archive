import { useGetStats, useListRecordings, useListPerformers, useListTags } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { PerformerCard } from "@/components/PerformerCard";
import { Button } from "@/components/ui/button";
import { Film, Users, HardDrive, ArrowRight, Search, PlaySquare, TrendingUp } from "lucide-react";
import { formatBytes } from "@/lib/formatters";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const [_, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const { data: stats, isLoading: statsLoading } = useGetStats();
  const { data: recentRecordings, isLoading: recentLoading } = useListRecordings({ 
    limit: 8, 
    sort: 'newest' 
  });
  const { data: topPerformers, isLoading: performersLoading } = useListPerformers();
  const { data: tags, isLoading: tagsLoading } = useListTags();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/browse?search=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 overflow-hidden flex flex-col items-center justify-center text-center px-4 border-b border-border/40">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-0" />
        
        <div className="relative z-10 max-w-3xl mx-auto space-y-8">
          <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl text-primary mb-2 shadow-lg shadow-primary/20">
            <PlaySquare className="w-10 h-10" />
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter">
            Premium <span className="text-primary">Archive</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-light leading-relaxed">
            The ultimate collection of high-quality recordings. Dark, fast, and organized for seamless browsing.
          </p>

          <form onSubmit={handleSearch} className="w-full max-w-xl mx-auto relative group mt-8">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-purple-600/50 rounded-full blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
            <div className="relative flex items-center">
              <Search className="absolute left-6 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search performers, tags, or titles..."
                className="w-full h-14 bg-card border border-border/50 rounded-full pl-14 pr-32 text-base outline-none focus:border-primary/50 shadow-xl transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button type="submit" className="absolute right-2 h-10 rounded-full px-6 bg-primary hover:bg-primary/90">
                Search
              </Button>
            </div>
          </form>

          {/* Stats Banner */}
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16 pt-12">
            <StatItem 
              icon={<Film className="w-5 h-5" />} 
              label="Recordings" 
              value={statsLoading ? null : stats?.total_recordings?.toLocaleString()} 
            />
            <StatItem 
              icon={<Users className="w-5 h-5" />} 
              label="Performers" 
              value={statsLoading ? null : stats?.total_performers?.toLocaleString()} 
            />
            <StatItem 
              icon={<HardDrive className="w-5 h-5" />} 
              label="Storage" 
              value={statsLoading ? null : formatBytes(stats?.total_size_bytes)} 
            />
          </div>
        </div>
      </section>

      {/* Recent Recordings */}
      <section className="py-20 container mx-auto px-4">
        <div className="flex items-center justify-between mb-10">
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-primary" />
            Recently Added
          </h2>
          <Link href="/browse" className="text-primary hover:text-primary/80 font-medium flex items-center gap-2 transition-colors">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {recentLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="w-full aspect-video rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : recentRecordings?.data.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 gap-y-10">
            {recentRecordings.data.map(rec => (
              <VideoCard key={rec.id} recording={rec} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            No recordings found.
          </div>
        )}
      </section>

      {/* Top Performers */}
      <section className="py-20 bg-secondary/30 border-y border-border/40">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-10">
            <h2 className="text-3xl font-bold tracking-tight">Top Performers</h2>
            <Link href="/performers" className="text-muted-foreground hover:text-foreground font-medium flex items-center gap-2 transition-colors">
              Directory <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          
          {performersLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {topPerformers?.slice(0, 6).map(perf => (
                <PerformerCard key={perf.username} performer={perf} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Popular Tags */}
      <section className="py-20 container mx-auto px-4 text-center">
        <h2 className="text-3xl font-bold tracking-tight mb-10">Popular Tags</h2>
        
        {tagsLoading ? (
          <div className="flex flex-wrap justify-center gap-3 max-w-4xl mx-auto">
            {[...Array(15)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-24 rounded-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-3 max-w-4xl mx-auto">
            {tags?.slice(0, 30).map(({ tag, count }) => (
              <Link 
                key={tag} 
                href={`/browse?tags=${encodeURIComponent(tag)}`}
                className="px-4 py-2 rounded-full bg-secondary/50 border border-border/50 hover:border-primary/50 hover:bg-secondary text-sm font-medium text-foreground/80 hover:text-primary transition-all duration-300"
              >
                {tag} <span className="opacity-50 ml-1 text-xs">{count}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 text-muted-foreground">
      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-foreground shadow-inner">
        {icon}
      </div>
      <div className="text-2xl font-bold text-foreground">
        {value || <Skeleton className="h-8 w-20" />}
      </div>
      <div className="text-xs font-medium uppercase tracking-widest opacity-60">
        {label}
      </div>
    </div>
  );
}
