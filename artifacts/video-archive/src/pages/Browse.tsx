import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useListRecordings, ListRecordingsSort } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, X, ChevronDown, Loader2, Filter } from "lucide-react";

const SORT_LABELS: Record<ListRecordingsSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  largest: "Largest",
  popular: "Most popular",
};

const GENDER_OPTIONS = [
  { value: "", label: "Any gender" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "couple", label: "Couple" },
  { value: "trans", label: "Trans" },
];

const RESOLUTION_OPTIONS = [
  { value: "", label: "Any resolution" },
  { value: "1080p", label: "1080p HD" },
  { value: "720p", label: "720p HD" },
  { value: "540p", label: "540p" },
  { value: "360p", label: "360p" },
];

export default function Browse() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const [, setLocation] = useLocation();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [tags, setTags] = useState(searchParams.get("tags") || "");
  const [gender, setGender] = useState(searchParams.get("gender") || "");
  const [resolution, setResolution] = useState(searchParams.get("resolution") || "");
  const [sort, setSort] = useState<ListRecordingsSort>(
    (searchParams.get("sort") as ListRecordingsSort) || ListRecordingsSort.newest,
  );
  const [allRecordings, setAllRecordings] = useState<any[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, isFetching } = useListRecordings({
    page,
    limit: 24,
    search: search || undefined,
    tags: tags || undefined,
    gender: gender || undefined,
    resolution: resolution || undefined,
    sort,
  });

  useEffect(() => {
    setPage(1);
    setAllRecordings([]);
  }, [searchString]);

  useEffect(() => {
    if (data?.data) {
      if (page === 1) {
        setAllRecordings(data.data);
      } else {
        setAllRecordings((prev) => {
          const newItems = data.data.filter((r) => !prev.some((p) => p.id === r.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [data]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchString);
    value ? params.set(key, value) : params.delete(key);
    params.delete("page");
    setLocation(`/browse?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilter("search", search);
  };

  const hasFilters = !!(
    search ||
    tags ||
    gender ||
    resolution ||
    sort !== ListRecordingsSort.newest
  );
  const hasMore = data ? data.total > allRecordings.length : false;

  const activePills = [
    tags && { key: "tags", label: `Tag: ${tags}` },
    gender && { key: "gender", label: `Gender: ${gender}` },
    resolution && { key: "resolution", label: resolution },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-8 border-b border-border/50 pb-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Browse</h1>
              {data && data.total != null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data.total.toLocaleString()} recordings
                </p>
              )}
            </div>

            <div className="sm:ml-auto flex flex-wrap items-center gap-2">
              {/* Search */}
              <form onSubmit={handleSearch} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                <input
                  type="text"
                  placeholder="Search recordings…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-44 sm:w-52 bg-secondary/50 border border-border/60 hover:border-border focus:border-primary/60 rounded pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/40"
                  aria-label="Search recordings"
                />
              </form>

              {/* Sort */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => updateFilter("sort", e.target.value)}
                  className="h-8 appearance-none bg-secondary/50 border border-border/60 hover:border-border rounded pl-3 pr-7 text-xs text-foreground outline-none transition-colors cursor-pointer"
                  aria-label="Sort recordings"
                >
                  {Object.entries(SORT_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>

              {/* Filters toggle (desktop: inline, mobile: toggle) */}
              <button
                onClick={() => setShowFilters((f) => !f)}
                className={`h-8 flex items-center gap-1.5 px-3 text-xs border rounded transition-colors ${
                  showFilters || gender || resolution
                    ? "border-primary/50 text-primary bg-primary/5"
                    : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
                aria-label="Toggle filters"
              >
                <Filter className="w-3 h-3" />
                Filters
                {(gender || resolution) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </button>

              {hasFilters && (
                <button
                  onClick={() => setLocation("/browse")}
                  className="h-8 flex items-center gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:border-border rounded transition-colors"
                >
                  <X className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="flex flex-wrap gap-2 pt-2">
              <div className="relative">
                <select
                  value={gender}
                  onChange={(e) => updateFilter("gender", e.target.value)}
                  className="h-8 appearance-none bg-secondary/50 border border-border/60 hover:border-border rounded pl-3 pr-7 text-xs text-foreground outline-none transition-colors cursor-pointer"
                  aria-label="Filter by gender"
                >
                  {GENDER_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>

              <div className="relative">
                <select
                  value={resolution}
                  onChange={(e) => updateFilter("resolution", e.target.value)}
                  className="h-8 appearance-none bg-secondary/50 border border-border/60 hover:border-border rounded pl-3 pr-7 text-xs text-foreground outline-none transition-colors cursor-pointer"
                  aria-label="Filter by resolution"
                >
                  {RESOLUTION_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          )}
        </div>

        {/* Active filter pills */}
        {activePills.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {activePills.map(({ key, label }) => (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 text-xs text-primary border border-primary/30 bg-primary/5 px-2.5 py-1 rounded-sm"
              >
                {label}
                <button
                  onClick={() => updateFilter(key, "")}
                  className="hover:text-white transition-colors"
                  aria-label={`Remove ${key} filter`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Tag pill */}
        {tags && (
          <div className="flex items-center gap-2 mb-6">
            <span className="text-xs text-muted-foreground">Tag:</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-primary border border-primary/30 bg-primary/5 px-2.5 py-1 rounded-sm">
              {tags}
              <button
                onClick={() => updateFilter("tags", "")}
                className="hover:text-white transition-colors"
                aria-label="Remove tag filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          </div>
        )}

        {/* Grid */}
        {isLoading && page === 1 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-8">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="space-y-2.5">
                <Skeleton className="w-full aspect-video rounded-sm" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : allRecordings.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-8">
              {allRecordings.map((rec) => (
                <VideoCard key={rec.id} recording={rec} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-12 flex justify-center">
                <button
                  className="h-10 px-10 border border-border/60 hover:border-border text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 flex items-center gap-2 rounded-sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={isFetching}
                >
                  {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isFetching ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="py-32 text-center border border-border/40 rounded">
            <p className="text-muted-foreground text-sm mb-4">No recordings match your filters.</p>
            <button
              onClick={() => setLocation("/browse")}
              className="text-xs text-primary hover:underline"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
