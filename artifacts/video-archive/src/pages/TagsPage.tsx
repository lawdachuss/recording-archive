import { useMemo, useState } from "react";
import { useListTags, getListTagsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AdBanner } from "@/components/ads/AdBanner";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { Tags, Hash, RefreshCw, Search, X } from "lucide-react";
import { filterTagsByQuery, sortTagsByCount } from "@/lib/tag-search";

export default function TagsPage() {
  const {
    data: tags,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useListTags({ query: { queryKey: getListTagsQueryKey(), staleTime: 30_000 } });
  const [tagSearch, setTagSearch] = useState("");

  const sorted = useMemo(() => sortTagsByCount(tags ?? []), [tags]);
  const filtered = useMemo(
    () => filterTagsByQuery(sorted, tagSearch),
    [sorted, tagSearch],
  );
  const maxCount = sorted[0]?.count ?? 1;
  const hasSearch = tagSearch.trim().length > 0;

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        <div className="mb-10">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <Tags className="w-3.5 h-3.5 text-primary" />
            Tags
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Browse by Tag</h1>
          {tags && (
            <p className="text-sm text-muted-foreground mt-2">
              {tags.length.toLocaleString()} categories across the archive
            </p>
          )}
        </div>

        {/* Top ad — 728×90 / 468×60 / 300×250 on phones */}
        <AdLeaderboard mobile="medium-rect-300x250" className="mb-10" />

        {!isLoading && !isError && sorted.length > 0 && (
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div role="search" className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
              <input
                type="search"
                value={tagSearch}
                onChange={(event) => setTagSearch(event.target.value)}
                placeholder="Find a tag…"
                aria-label="Search tags"
                aria-controls="tag-results"
                autoComplete="off"
                className="h-10 w-full bg-secondary border border-border/60 hover:border-border focus:border-primary/60 rounded-lg pl-9 pr-10 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/10"
              />
              {tagSearch && (
                <button
                  type="button"
                  onClick={() => setTagSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-background/70 transition-colors"
                  aria-label="Clear tag search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground/70 tabular-nums" role="status">
              {hasSearch
                ? `${filtered.length.toLocaleString()} of ${sorted.length.toLocaleString()} tags match`
                : `${sorted.length.toLocaleString()} tags`}
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-wrap gap-2">
            {[...Array(40)].map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-lg" style={{ width: `${60 + Math.random() * 100}px` }} />
            ))}
          </div>
        ) : isError && !tags ? (
          <div className="py-20 text-center border border-border/30 rounded-2xl bg-secondary/10" role="alert">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Tags className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Tags couldn’t be loaded.</p>
            <p className="text-xs text-muted-foreground mb-5">The archive may be temporarily unavailable. Your data hasn’t been changed.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-primary border border-primary/30 hover:border-primary/60 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              Try again
            </button>
          </div>
        ) : filtered.length > 0 ? (
          <div id="tag-results" className="flex flex-wrap gap-2 items-baseline" aria-label="Tag results">
            {filtered.map(({ tag, count }, index) => {
              const weight = count / maxCount;
              const size = weight > 0.7 ? "text-base font-bold" : weight > 0.4 ? "text-sm font-semibold" : "text-xs font-medium";
              const opacity = weight > 0.5 ? "text-foreground" : weight > 0.2 ? "text-foreground/70" : "text-muted-foreground";
              const padding = weight > 0.7 ? "px-3 py-1.5" : weight > 0.4 ? "px-2.5 py-1" : "px-2 py-0.5";

              return (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className={`inline-flex items-baseline gap-1.5 ${padding} border border-border/40 hover:border-primary/40 hover:bg-primary/5 hover:text-primary rounded-lg transition-all duration-200 animate-fade-in-up ${size} ${opacity}`}
                  style={{ animationDelay: `${(index % 40) * 15}ms` }}
                >
                  <Hash className={`w-2.5 h-2.5 opacity-40 self-center ${weight > 0.5 ? "inline" : "hidden sm:inline"}`} />
                  {tag}
                  <span className="text-[10px] text-muted-foreground/50 font-normal tabular-nums">{count}</span>
                </Link>
              );
            })}
          </div>
        ) : hasSearch ? (
          <div className="py-20 text-center border border-border/30 rounded-2xl bg-secondary/10" role="status">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Search className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">No tags match “{tagSearch.trim()}”.</p>
            <p className="text-xs text-muted-foreground mb-5">Try a shorter term or check the spelling.</p>
            <button
              type="button"
              onClick={() => setTagSearch("")}
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-primary border border-primary/30 hover:border-primary/60 rounded-lg transition-colors"
            >
              <X className="w-3 h-3" />
              Clear search
            </button>
          </div>
        ) : (
          <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Tags className="w-6 h-6 text-muted-foreground/20" />
            </div>
            <p className="text-sm text-muted-foreground">No tags found.</p>
          </div>
        )}
        {/* Bottom ad — 300×100 rectangle */}
        <div className="mt-10 flex justify-center">
          <AdBanner file="rect-300x100" />
        </div>
      </div>
    </Layout>
  );
}
