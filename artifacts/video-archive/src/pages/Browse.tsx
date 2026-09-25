import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  Fragment,
} from "react";
import { useSearch, useLocation } from "wouter";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import {
  useListRecordings,
  useListTags,
  listRecordings,
  getListRecordingsQueryKey,
  getListTagsQueryKey,
  ListRecordingsSort,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { VideoCard } from "@/components/VideoCard";
import { AdGridCard } from "@/components/ads/AdGridCard";
import { isAdCard } from "@/lib/ad-creatives";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { usePreloadRecordings } from "@/hooks/use-preload-recordings";
import { useContinuousPrefetch } from "@/hooks/use-continuous-prefetch";
import { isConnectionConstrained } from "@/lib/connection";
import {
  Search,
  X,
  ChevronDown,
  SlidersHorizontal,
  Tag,
  Filter,
  Bookmark,
  Check,
  Plus,
  Trash2,
  Clapperboard,
} from "lucide-react";
import { AppPagination } from "@/components/ui/app-pagination";
import {
  getFilterPresets,
  saveFilterPreset,
  deleteFilterPreset,
  type FilterPreset,
} from "@/lib/filter-presets";
import { GENDER_OPTIONS, genderLabel } from "@/lib/genders";

const SORT_LABELS: Record<ListRecordingsSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  largest: "Largest",
  popular: "Most viewed",
};

// Slow/constrained links get a lighter browsing grid (12 items vs 40) so the
// first page of thumbnails doesn't saturate the connection. Evaluated once at
// module load so pagination state stays consistent for the whole session.
const ITEMS_PER_PAGE = isConnectionConstrained() ? 12 : 40;

function parseTagList(raw: string): string[] {
  return raw
    ? raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
}

function parsePage(raw: string | null): number {
  const n = parseInt(raw || "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseSort(raw: string | null): ListRecordingsSort {
  const v = raw || "newest";
  return Object.prototype.hasOwnProperty.call(SORT_LABELS, v)
    ? (v as ListRecordingsSort)
    : "newest";
}

export default function Browse() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const [search, setSearch] = useState(
    () => new URLSearchParams(searchString).get("search") || "",
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    parseTagList(new URLSearchParams(searchString).get("tags") || ""),
  );
  const [gender, setGender] = useState(
    () => new URLSearchParams(searchString).get("gender") || "",
  );
  const [sort, setSort] = useState<ListRecordingsSort>(() =>
    parseSort(new URLSearchParams(searchString).get("sort")),
  );
  const [showFilters, setShowFilters] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [pageLoading, setPageLoading] = useState(false);

  // ─── Filter presets ──────────────────────────────────
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetRef = useRef<HTMLDivElement>(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<FilterPreset[]>(() =>
    getFilterPresets(),
  );
  const [savedPresetId, setSavedPresetId] = useState<string | null>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!presetMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [presetMenuOpen]);

  const { data: tagsData } = useListTags({
    query: { queryKey: getListTagsQueryKey(), staleTime: 60_000 },
  });
  const popularTags = useMemo(() => tagsData ?? [], [tagsData]);

  const filteredPopularTags = useMemo(() => {
    const unselected = popularTags.filter((t) => !selectedTags.includes(t.tag));
    if (!tagSearch.trim()) return unselected.slice(0, 50);
    return unselected
      .filter((t) => t.tag.toLowerCase().includes(tagSearch.toLowerCase()))
      .slice(0, 50);
  }, [popularTags, tagSearch, selectedTags]);

  const recordingsParams = useMemo(() => {
    const p = new URLSearchParams(searchString);
    return {
      page: parsePage(p.get("page")),
      limit: ITEMS_PER_PAGE,
      search: p.get("search") || undefined,
      tags: parseTagList(p.get("tags") || "").join(",") || undefined,
      gender: p.get("gender") || undefined,
      sort: parseSort(p.get("sort")),
    };
  }, [searchString]);

  const { data, isLoading, isFetching } = useListRecordings(recordingsParams, {
    query: {
      queryKey: getListRecordingsQueryKey(recordingsParams),
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    },
  });

  const recentlyWatched = useRecentlyWatched();
  const recordings = data?.data ?? [];

  // ─── Current-page media preload ───────────────────────────────────────
  // Sprites + thumbnails + reachable previews are the hover/grid media, so
  // warm ALL of them on this page during idle (dedup'd + bounded concurrency
  // in preloadRecordingMedia) — hovering any card later is instant instead of
  // waiting for a fresh fetch.
  usePreloadRecordings(recordings);

  const queryClient = useQueryClient();

  // ─── Continuous next-page prefetch (data + media) ────────────────────
  // fetchPage stores every page under the SAME query key/queryFn the page
  // navigation hook uses (ensureQueryData), so:
  //   - the 5-pages-ahead data download happens ONCE and is reused the moment
  //     the user clicks into that page (previously a raw fetch threw the
  //     response away, so navigation re-downloaded it — and page+1 was
  //     fetched TWICE, once raw and once by prefetchQuery);
  //   - in-flight fetches dedupe with the scroll-triggered prefetchQuery.
  // Media (thumbnails + sprites + previews) warms through the unified,
  // connection-aware preload queue ahead of the scroll.
  const fetchNextPrefetchPage = useCallback(
    async (page: number) => {
      const params = { ...recordingsParams, page };
      const res = await queryClient.ensureQueryData({
        queryKey: getListRecordingsQueryKey(params),
        queryFn: ({ signal }) => listRecordings(params, { signal }),
        staleTime: 5 * 60_000,
      });
      return (res?.data ?? []) as Array<{
        id: string | number;
        thumbnail_url?: string | null;
        sprite_url?: string | null;
        preview_url?: string | null;
      }>;
    },
    [recordingsParams, queryClient],
  );

  // Filters/sort/search WITHOUT the page — the prefetch window resets when
  // this changes so pages warmed for the old result set never count as warm
  // for the new one (old bug: after any filter change, prefetch was dead
  // until the user scrolled past the previous query's high-water mark).
  const prefetchResetKey = useMemo(() => {
    const { page: _page, ...filters } = recordingsParams;
    return JSON.stringify(filters);
  }, [recordingsParams]);

  const { sentinelRef: continuousSentinelRef } = useContinuousPrefetch({
    fetchPage: fetchNextPrefetchPage,
    currentPage: recordingsParams.page,
    // Warm 5 pages ahead so scrolling/hovering is instant everywhere in the
    // next several screens. The very next page's thumbnails are warmed eager
    // in full; near pages (within previewDepth) get full media (thumbs +
    // sprites + animated previews); far ones get thumbs + sprites only.
    prefetchAhead: 5,
    previewDepth: 2,
    eagerThumbs: ITEMS_PER_PAGE,
    // Prime the next page's thumbnails as soon as this page's data arrives,
    // instead of only when the user scrolls near the bottom.
    startSignal: data,
    resetKey: prefetchResetKey,
  });

  // ─── Next-page prefetch (data + previews) ─────────────────────────
  // When the user scrolls toward the bottom of the list, prefetch the next
  // page of recordings into the React Query cache and warm the preview clips
  // so navigating (or hovering) is instant.
  const prefetchedForRef = useRef("");

  const prefetchNextPage = useCallback(() => {
    if (!data) return;
    // A partial page means there is no next page (also covers stale
    // keepPreviousData totals during filter changes).
    if (data.data.length < recordingsParams.limit) return;
    const next = recordingsParams.page + 1;
    if (next > Math.ceil(data.total / recordingsParams.limit)) return;

    const nextParams = { ...recordingsParams, page: next };
    const queryKey = getListRecordingsQueryKey(nextParams);
    // One-shot guard keyed by the query (auto-resets on filter/page changes).
    const guardKey = JSON.stringify(queryKey);
    if (prefetchedForRef.current === guardKey) return;
    // Already fetched (e.g. visited before or restored from cache) — nothing to do.
    if (queryClient.getQueryData(queryKey) !== undefined) return;

    prefetchedForRef.current = guardKey;
    queryClient
      .prefetchQuery({
        queryKey,
        queryFn: () => listRecordings(nextParams),
        staleTime: 5 * 60_000,
      });
  }, [data, recordingsParams, queryClient]);

  const prefetchNextPageRef = useRef(prefetchNextPage);
  useEffect(() => {
    prefetchNextPageRef.current = prefetchNextPage;
  }, [prefetchNextPage]);

  // Warm the next page's DATA right when the current page loads (the media
  // hooks warm its thumbnails). Previously this only ran on scroll, so users
  // who paginated without scrolling to the bottom hit a cold grid.
  useEffect(() => {
    prefetchNextPage();
  }, [prefetchNextPage]);

  // Observe a sentinel near the bottom of the grid; fire the prefetch when it
  // approaches the viewport (1200px early) so the next page is ready before
  // the user reaches the pagination.
  const hasRecordings = recordings.length > 0;
  useEffect(() => {
    if (!hasRecordings) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) prefetchNextPageRef.current();
        }
      },
      { rootMargin: "1200px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasRecordings]);

  const handlePageChange = (newPage: number) => {
    setPageLoading(true);
    const params = new URLSearchParams(searchString);
    if (newPage > 1) params.set("page", String(newPage));
    else params.delete("page");
    const qs = params.toString();
    setLocation(`/browse${qs ? "?" + qs : ""}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  // Clamp out-of-range pages (e.g. deep-linked `?page=99` on a small result
  // set): rewrite the URL to the last valid page so we never render a bogus
  // empty state / "Page 99 of 3" while valid filters are applied.
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / ITEMS_PER_PAGE));
  useEffect(() => {
    const current = recordingsParams.page;
    if (!data || current <= totalPages) return;
    handlePageChange(totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, totalPages]);

  // Use isFetching (true while refetching) to clear the loading overlay
  // rather than checking data — keepPreviousData keeps stale data alive.
  useEffect(() => {
    if (!isFetching && pageLoading) {
      // Small delay to ensure the DOM has updated with new data
      const t = setTimeout(() => setPageLoading(false), 50);
      return () => clearTimeout(t);
    }
    return;
  }, [isFetching, pageLoading]);

  useEffect(() => {
    const p = new URLSearchParams(searchString);
    setSearch(p.get("search") || "");
    setSelectedTags(parseTagList(p.get("tags") || ""));
    setGender(p.get("gender") || "");
    setSort(parseSort(p.get("sort")));
  }, [searchString]);

  const pushFilters = useCallback(
    (overrides: {
      search?: string;
      tags?: string[];
      gender?: string;
      sort?: string;
    }) => {
      // Use the *committed* search (from the URL), not the local input state —
      // text that's been typed but not submitted shouldn't leak into filters
      // when the user changes sort/tags/gender.
      const committedSearch = new URLSearchParams(searchString).get("search") || "";
      const next = {
        search: committedSearch,
        tags: selectedTags,
        gender,
        sort: sort as string,
        ...overrides,
      };
      // Keep local state in sync with the merged values so the UI (chips,
      // sort select, filter pills) reflects what we push to the URL. Without
      // this, toggling a gender chip never updates the UI and the filter
      // becomes impossible to deselect.
      setSearch(next.search);
      setSelectedTags(next.tags);
      setGender(next.gender);
      setSort((next.sort as ListRecordingsSort) || "newest");
      const params = new URLSearchParams();
      if (next.search) params.set("search", next.search);
      if (next.tags.length) params.set("tags", next.tags.join(","));
      if (next.gender) params.set("gender", next.gender);
      if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
      setLocation(`/browse${params.toString() ? "?" + params.toString() : ""}`);
    },
    [search, selectedTags, gender, sort, searchString, setLocation],
  );

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

  const toggleGender = (val: string) =>
    pushFilters({ gender: gender === val ? "" : val });

  const clearAll = () => setLocation("/browse");

  const hasFilters = !!(
    search ||
    selectedTags.length ||
    gender ||
    sort !== "newest"
  );
  const activeFilterCount =
    (selectedTags.length > 0 ? 1 : 0) + (gender ? 1 : 0);

  // ─── Filter presets handlers ────────────────────────────
  const refreshPresets = () => setPresets(getFilterPresets());

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    const saved = saveFilterPreset({
      name: presetName.trim(),
      search,
      tags: selectedTags,
      gender,
      resolution: "",
      sort: sort as string,
    });
    setSavedPresetId(saved.id);
    setSavePresetOpen(false);
    setPresetName("");
    refreshPresets();
    setTimeout(() => setSavedPresetId(null), 2000);
  };

  const handleLoadPreset = (preset: FilterPreset) => {
    const params = new URLSearchParams();
    if (preset.search) params.set("search", preset.search);
    if (preset.tags.length) params.set("tags", preset.tags.join(","));
    if (preset.gender) params.set("gender", preset.gender);
    if (preset.sort && preset.sort !== "newest")
      params.set("sort", preset.sort);
    setPresetMenuOpen(false);
    setLocation(`/browse${params.toString() ? "?" + params.toString() : ""}`);
  };

  const handleDeletePreset = (id: string) => {
    deleteFilterPreset(id);
    refreshPresets();
  };

  return (
    <Layout>
      <section className="px-4 sm:px-6 py-10">
        <div className="container mx-auto">
          {/* ── Top bar ─────────────────────────────────────── */}
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div>
                <div className="flex items-center gap-2.5 mb-0.5">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Clapperboard className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <h1 className="text-xl font-bold tracking-tight">Browse</h1>
                </div>
                {data && data.total != null && (
                  <p className="text-xs text-muted-foreground/70 ml-9.5">
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
                    className="h-8 w-44 sm:w-56 bg-secondary border border-border/60 hover:border-border focus:border-primary/60 rounded-lg pl-8 pr-3 text-xs outline-none transition-all duration-200 placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/5"
                    aria-label="Search recordings"
                  />
                </form>

                {/* Sort */}
                <div className="relative">
                  <select
                    value={sort}
                    onChange={(e) => pushFilters({ sort: e.target.value })}
                    className="h-8 appearance-none bg-secondary border border-border/60 hover:border-border rounded pl-3 pr-7 text-xs text-foreground outline-none transition-colors cursor-pointer"
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

                {/* Filter presets — save / load */}
                <div ref={presetRef} className="relative">
                  <button
                    onClick={() => {
                      setPresetMenuOpen((p) => !p);
                      setSavePresetOpen(false);
                    }}
                    className={`h-8 flex items-center gap-1.5 px-3 text-xs border rounded transition-all ${
                      presetMenuOpen
                        ? "border-primary/60 text-primary"
                        : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                    }`}
                    aria-label="Filter presets"
                  >
                    <Bookmark className="w-3 h-3" />
                    Presets
                  </button>

                  {presetMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-64 glass-dropdown rounded overflow-hidden">
                      <div className="p-2 border-b border-border/40">
                        <div className="flex gap-1">
                          <input
                            ref={saveInputRef}
                            type="text"
                            placeholder="Save current as…"
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSavePreset();
                            }}
                            maxLength={40}
                            className="flex-1 h-7 bg-card border border-border/40 focus:border-primary/50 rounded-[2px] px-2 text-xs outline-none"
                          />
                          <button
                            onClick={handleSavePreset}
                            disabled={!presetName.trim()}
                            className="w-7 h-7 flex items-center justify-center border border-primary/30 text-primary rounded-[2px] disabled:opacity-40 hover:border-primary/60 transition-opacity"
                            title="Save preset"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {presets.length === 0 ? (
                        <div className="px-3 py-4 text-center">
                          <p className="text-[11px] text-muted-foreground">
                            No saved presets.
                          </p>
                          <p className="text-[11px] text-muted-foreground/60">
                            Save filter combos above.
                          </p>
                        </div>
                      ) : (
                        <div className="max-h-48 overflow-y-auto">
                          {presets.map((preset) => (
                            <div
                              key={preset.id}
                              className="flex items-center gap-1 px-2 py-1.5 text-xs hover:bg-secondary transition-colors group"
                            >
                              <button
                                onClick={() => handleLoadPreset(preset)}
                                className="flex-1 flex items-center gap-2 min-w-0 text-left"
                              >
                                {savedPresetId === preset.id ? (
                                  <Check className="w-3 h-3 text-green-500 shrink-0" />
                                ) : (
                                  <Bookmark className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                                )}
                                <span className="truncate">{preset.name}</span>
                                {(preset.tags.length > 0 || preset.gender) && (
                                  <span className="text-[9px] text-muted-foreground/40 shrink-0 ml-auto">
                                    {[
                                      preset.gender,
                                      ...preset.tags.slice(0, 2),
                                    ]
                                      .filter(Boolean)
                                      .join(", ")}
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => handleDeletePreset(preset.id)}
                                className="w-5 h-5 flex items-center justify-center text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                title="Delete preset"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Filter toggle */}
                <button
                  onClick={() => {
                    setShowFilters((f) => !f);
                    setPresetMenuOpen(false);
                  }}
                  className={`h-8 flex items-center gap-1.5 px-3 text-xs border rounded transition-all ${
                    showFilters || activeFilterCount > 0
                      ? "border-primary/60 text-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                  aria-label="Toggle filters"
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="ml-0.5 min-w-[16px] h-4 rounded-full border border-primary/40 text-primary text-[9px] font-bold flex items-center justify-center px-1">
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
              <div className="border border-border/50 rounded-xl bg-secondary p-4 sm:p-5 space-y-5 animate-fade-in-up">
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
                        className={`h-7 px-3 text-[11px] font-medium rounded-lg border transition-all duration-150 ${
                          gender === value
                            ? "border-primary/60 text-primary"
                            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground hover:bg-background/50"
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
                        <span className="ml-1.5 text-primary font-bold normal-case tracking-normal text-[11px]">
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
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {selectedTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium border border-primary/60 text-primary rounded-lg hover:border-primary/80 transition-all duration-150"
                        >
                          {tag}
                          <X className="w-2.5 h-2.5" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Tag search input */}
                  <div className="relative mb-2.5">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                    <input
                      type="text"
                      placeholder="Search tags…"
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      className="w-full h-8 bg-background border border-border/60 focus:border-primary/50 rounded-lg pl-7 pr-3 text-xs outline-none transition-all duration-200 placeholder:text-muted-foreground/40"
                    />
                  </div>

                  {/* Unselected tag grid */}
                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {filteredPopularTags.map(({ tag, count }) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 rounded-lg transition-all duration-150 dark:bg-card"
                      >
                        {tag}
                        <span className="text-[9px] text-muted-foreground/50 font-medium">
                          {count}
                        </span>
                      </button>
                    ))}
                    {filteredPopularTags.length === 0 && tagSearch && (
                      <p className="text-[11px] text-muted-foreground/50 py-2 italic">
                        No tags match "{tagSearch}"
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Active filter pills */}
            {(selectedTags.length > 0 || gender) && (
              <div className="flex flex-wrap items-center gap-1.5 animate-fade-in-up">
                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide shrink-0">
                  Filtering by:
                </span>
                {gender && (
                  <span className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium text-primary border border-primary/30 rounded-lg">
                    {genderLabel(gender)}
                    <button
                      onClick={() => toggleGender(gender)}
                      className="hover:text-primary/80 transition-colors"
                      aria-label="Remove gender filter"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
                {selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium text-primary border border-primary/30 rounded-lg"
                  >
                    #{tag}
                    <button
                      onClick={() => toggleTag(tag)}
                      className="hover:text-primary/80 transition-colors"
                      aria-label={`Remove ${tag} tag filter`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Grid ──────────────────────────────────────────── */}
        </div>
      </section>

      <section className="px-4 sm:px-6 py-10 pt-2">
        <div className="container mx-auto">
          {/* Top-of-grid ad — 728×90 / 468×60 / 300×100 */}
          <AdLeaderboard className="mb-8" />

          {isLoading && recordingsParams.page === 1 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
              {Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                <div key={i} className="space-y-2.5 animate-pulse">
                  <div className="w-full aspect-video rounded-lg bg-secondary/60" />
                  <div className="h-3 w-3/4 rounded bg-secondary/40" />
                  <div className="h-3 w-1/2 rounded bg-secondary/30" />
                </div>
              ))}
            </div>
          ) : recordings.length > 0 ? (
            <>
              <div className="relative">
                <div
                  className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 animate-fade-in-up ${pageLoading ? "opacity-30 saturate-50" : "transition-all duration-300"}`}
                >
                  {recordings.map((rec, i) => (
                    <Fragment key={rec.id}>
                      <VideoCard
                        recording={rec}
                        fetchPriority={i < 10 ? "high" : undefined}
                        isWatched={recentlyWatched.has(rec.id)}
                        showAdd
                      />
                      {isAdCard(recordings, i) && <AdGridCard />}
                    </Fragment>
                  ))}
                </div>

                {pageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/80 backdrop-blur-sm transition-all duration-300">
                    <div className="flex flex-col items-center gap-3">
                      <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span className="text-xs text-muted-foreground animate-pulse">
                        Loading page…
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Scroll sentinel — triggers data + media prefetch of the next
                  page (Browse's own observer prefetches data; the continuous
                  prefetch hook warms media on the same element). */}
              <div
                ref={(el) => {
                  sentinelRef.current = el;
                  continuousSentinelRef.current = el;
                }}
                aria-hidden
                className="h-px w-full"
              />
            </>
          ) : (
            <div className="py-24 sm:py-32 text-center border border-border/30 rounded-2xl bg-secondary/10">
              <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                <Filter className="w-6 h-6 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">
                No recordings match your filters.
              </p>
              <p className="text-xs text-muted-foreground/40 mb-5 max-w-xs mx-auto">
                Try different search terms or clear filters to see more results.
              </p>
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors"
              >
                <X className="w-3 h-3" />
                Clear all filters
              </button>
            </div>
          )}

          {/* Pre-pagination ad — responsive rectangle: 728×90 / 468×60 / 300×100 */}
          <AdLeaderboard mobile="rect-300x100" className="mt-12" />

          {/* ── Pagination (renders even on empty pages so users can navigate back) ── */}
          {data && data.total > 0 && (
            <div className="mt-12 flex flex-col items-center gap-4">
              <div className="text-xs text-muted-foreground/60 flex items-center gap-2">
                <span className="tabular-nums">Page {recordingsParams.page}</span>
                <span className="w-px h-3 bg-border/40" />
                <span className="tabular-nums">
                  {Math.ceil(data.total / recordingsParams.limit)} total
                </span>
                <span className="w-px h-3 bg-border/40" />
                <span className="tabular-nums">
                  {data.total.toLocaleString()}
                </span>{" "}
                recordings
              </div>
              <div className="w-full max-w-4xl flex justify-center">
                <AppPagination
                  itemsCount={data.total}
                  itemsPerPage={ITEMS_PER_PAGE}
                  currentPage={recordingsParams.page}
                  onPageChange={handlePageChange}
                  pageRangeDisplayed={5}
                  marginPagesDisplayed={2}
                />
              </div>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
