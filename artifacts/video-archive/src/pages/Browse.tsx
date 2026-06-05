import { useState, useEffect, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useListRecordings, useListTags, ListRecordingsSort } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, X, ChevronDown, Loader2, SlidersHorizontal, Tag, Filter } from "lucide-react";

const SORT_LABELS: Record<ListRecordingsSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  largest: "Largest",
  popular: "Most popular",
};

const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "couple", label: "Couple" },
  { value: "trans", label: "Trans" },
];

const RESOLUTION_OPTIONS = [
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "540p", label: "540p" },
  { value: "360p", label: "360p" },
];

function parseTagList(raw: string): string[] {
  return raw ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

export default function Browse() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => new URLSearchParams(searchString).get("search") || "");
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    parseTagList(new URLSearchParams(searchString).get("tags") || ""),
  );
  const [gender, setGender] = useState(() => new URLSearchParams(searchString).get("gender") || "");
  const [resolution, setResolution] = useState(
    () => new URLSearchParams(searchString).get("resolution") || "",
  );
  const [sort, setSort] = useState<ListRecordingsSort>(
    () =>
      (new URLSearchParams(searchString).get("sort") as ListRecordingsSort) ||
      ListRecordingsSort.newest,
  );
  const [allRecordings, setAllRecordings] = useState<any[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [tagSearch, setTagSearch] = useState("");

  const { data: tagsData } = useListTags();
  const popularTags = useMemo(() => tagsData ?? [], [tagsData]);

  const filteredPopularTags = useMemo(() => {
    const unselected = popularTags.filter((t) => !selectedTags.includes(t.tag));
    if (!tagSearch.trim()) return unselected.slice(0, 50);
    return unselected.filter((t) => t.tag.toLowerCase().includes(tagSearch.toLowerCase())).slice(0, 50);
  }, [popularTags, tagSearch, selectedTags]);

  const tagsParam = selectedTags.join(",");

  const { data, isLoading, isFetching } = useListRecordings({
    page,
    limit: 24,
    search: search || undefined,
    tags: tagsParam || undefined,
    gender: gender || undefined,
    resolution: resolution || undefined,
    sort,
  });

  useEffect(() => {
    const p = new URLSearchParams(searchString);
    setSearch(p.get("search") || "");
    setSelectedTags(parseTagList(p.get("tags") || ""));
    setGender(p.get("gender") || "");
    setResolution(p.get("resolution") || "");
    setSort((p.get("sort") as ListRecordingsSort) || ListRecordingsSort.newest);
    setPage(1);
    setAllRecordings([]);
  }, [searchString]);

  useEffect(() => {
    if (data?.data) {
      if (page === 1) {
        setAllRecordings(data.data);
      } else {
        setAllRecordings((prev) => {
          const newItems = data.data.filter((r: any) => !prev.some((p: any) => p.id === r.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [data, page]);

  const pushFilters = (overrides: {
    search?: string;
    tags?: string[];
    gender?: string;
    resolution?: string;
    sort?: string;
  }) => {
    const next = {
      search,
      tags: selectedTags,
      gender,
      resolution,
      sort: sort as string,
      ...overrides,
    };
    const params = new URLSearchParams();
    if (next.search) params.set("search", next.search);
    if (next.tags.length) params.set("tags", next.tags.join(","));
    if (next.gender) params.set("gender", next.gender);
    if (next.resolution) params.set("resolution", next.resolution);
    if (next.sort && next.sort !== ListRecordingsSort.newest) params.set("sort", next.sort);
    setLocation(`/browse${params.toString() ? "?" + params.toString() : ""}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    pushFilters({ search });
  };

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    pushFilters({ tags: next });
  };

  const toggleGender = (val: string) => pushFilters({ gender: gender === val ? "" : val });
  const toggleResolution = (val: string) =>
    pushFilters({ resolution: resolution === val ? "" : val });

  const clearAll = () => setLocation("/browse");

  const hasFilters = !!(
    search ||
    selectedTags.length ||
    gender ||
    resolution ||
    sort !== ListRecordingsSort.newest
  );
  const hasMore = data ? data.total > allRecordings.length : false;
  const activeFilterCount =
    (selectedTags.length > 0 ? 1 : 0) + (gender ? 1 : 0) + (resolution ? 1 : 0);

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10">
        {/* ── Top bar ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") pushFilters({ search: (e.target as HTMLInputElement).value });
                  }}
                  className="h-8 w-44 sm:w-56 bg-secondary/50 border border-border/60 hover:border-border focus:border-primary/60 rounded pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/40"
                  aria-label="Search recordings"
                />
              </form>

              {/* Sort */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => pushFilters({ sort: e.target.value })}
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

              {/* Filter toggle */}
              <button
                onClick={() => setShowFilters((f) => !f)}
                className={`h-8 flex items-center gap-1.5 px-3 text-xs border rounded transition-all ${
                  showFilters || activeFilterCount > 0
                    ? "border-primary/50 text-primary bg-primary/5"
                    : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
                aria-label="Toggle filters"
              >
                <SlidersHorizontal className="w-3 h-3" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 min-w-[16px] h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center px-1">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {hasFilters && (
                <button
                  onClick={clearAll}
                  className="h-8 flex items-center gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:border-border rounded transition-colors"
                >
                  <X className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>
          </div>

          {/* ── Expanded filter panel ─────────────────────── */}
          {showFilters && (
            <div className="border border-border/50 rounded bg-secondary/20 p-4 space-y-5">
              {/* Gender chips */}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2.5">
                  Gender
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {GENDER_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => toggleGender(value)}
                      className={`h-7 px-3 text-[11px] font-medium rounded-sm border transition-all ${
                        gender === value
                          ? "bg-primary text-white border-primary"
                          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution chips */}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2.5">
                  Resolution
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {RESOLUTION_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => toggleResolution(value)}
                      className={`h-7 px-3 text-[11px] font-medium rounded-sm border transition-all ${
                        resolution === value
                          ? "bg-primary text-white border-primary"
                          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags multi-select */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
                    <Tag className="w-3 h-3" />
                    Tags
                    {selectedTags.length > 0 && (
                      <span className="text-primary font-bold normal-case tracking-normal">
                        {selectedTags.length} selected
                      </span>
                    )}
                  </p>
                  {selectedTags.length > 0 && (
                    <button
                      onClick={() => pushFilters({ tags: [] })}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear tags
                    </button>
                  )}
                </div>

                {/* Selected tag chips */}
                {selectedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2.5">
                    {selectedTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className="inline-flex items-center gap-1 h-6 px-2 text-[11px] bg-primary text-white rounded-sm hover:bg-primary/80 transition-colors"
                      >
                        {tag}
                        <X className="w-2.5 h-2.5" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Tag search input */}
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                  <input
                    type="text"
                    placeholder="Search tags…"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    className="w-full h-7 bg-background border border-border/60 focus:border-primary/50 rounded-sm pl-7 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/40"
                  />
                </div>

                {/* Unselected tag grid */}
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {filteredPopularTags.map(({ tag, count }) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className="inline-flex items-center gap-1 h-6 px-2 text-[11px] border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary rounded-sm transition-all"
                    >
                      {tag}
                      <span className="text-[9px] text-muted-foreground/40">{count}</span>
                    </button>
                  ))}
                  {filteredPopularTags.length === 0 && tagSearch && (
                    <p className="text-[11px] text-muted-foreground/50 py-2">No tags match "{tagSearch}"</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Active filter pills */}
          {(selectedTags.length > 0 || gender || resolution) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide shrink-0">
                Filtering by:
              </span>
              {gender && (
                <span className="inline-flex items-center gap-1 h-6 px-2 text-[11px] text-primary border border-primary/30 bg-primary/5 rounded-sm">
                  {gender}
                  <button onClick={() => toggleGender(gender)} aria-label="Remove gender filter">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              )}
              {resolution && (
                <span className="inline-flex items-center gap-1 h-6 px-2 text-[11px] text-primary border border-primary/30 bg-primary/5 rounded-sm">
                  {resolution}
                  <button
                    onClick={() => toggleResolution(resolution)}
                    aria-label="Remove resolution filter"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              )}
              {selectedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 h-6 px-2 text-[11px] text-primary border border-primary/30 bg-primary/5 rounded-sm"
                >
                  #{tag}
                  <button onClick={() => toggleTag(tag)} aria-label={`Remove ${tag} tag filter`}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Grid ──────────────────────────────────────────── */}
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
            <Filter className="w-8 h-8 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm mb-4">No recordings match your filters.</p>
            <button onClick={clearAll} className="text-xs text-primary hover:underline">
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
