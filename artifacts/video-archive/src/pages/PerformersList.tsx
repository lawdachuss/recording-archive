import { useState, useRef } from "react";
import { useListPerformers } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { PerformerCard } from "@/components/PerformerCard";
import { Search, X, ChevronDown, Users } from "lucide-react";
import { AppPagination } from "@/components/ui/app-pagination";

type SortOption = "name" | "count";
const ITEMS_PER_PAGE = 49;

export default function PerformersList() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("count");
  const [gender, setGender] = useState("");
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isFetching } = useListPerformers({
    page,
    limit: ITEMS_PER_PAGE,
    search: search || undefined,
    gender: gender || undefined,
    sort,
  });

  const performers = data?.performers ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const ALL_GENDERS = [
    { value: "F", label: "Female" },
    { value: "M", label: "Male" },
    { value: "T", label: "Trans" },
    { value: "NB", label: "Non‑binary" },
    { value: "O", label: "Other" },
  ];

  const hasFilters = !!(search || gender || sort !== "count");

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Layout>
      <div ref={scrollRef} className="container mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* ── Header ─────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/5">
              <Users className="w-[18px] h-[18px] text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Performers</h1>
              <p className="text-[11px] text-muted-foreground/60 mt-px">
                {isLoading ? (
                  <span className="w-12 h-[10px] rounded bg-muted-foreground/20 animate-pulse inline-block align-middle" />
                ) : (
                  <span className="tabular-nums">{total.toLocaleString()}</span>
                )}
                {" "}total
              </p>
            </div>
          </div>
        </div>

        {/* ── Filter toolbar ──────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <div className="relative grow sm:grow-0 sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
            <input
              type="text"
              placeholder="Search performers…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="h-9 w-full bg-secondary border border-border/50 hover:border-border/80 focus:border-primary/50 rounded-lg pl-8 pr-8 text-xs outline-none transition-all duration-200 placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/8"
              aria-label="Search performers"
            />
            {search && (
              <button
                onClick={() => { setSearch(""); setPage(1); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="relative">
            <select
              value={gender}
              onChange={(e) => { setGender(e.target.value); setPage(1); }}
              className="h-9 appearance-none bg-secondary border border-border/50 hover:border-border/80 rounded-lg pl-3 pr-8 text-xs text-foreground outline-none transition-colors cursor-pointer"
              aria-label="Filter by gender"
            >
              <option value="">All genders</option>
              {ALL_GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as SortOption); setPage(1); }}
              className="h-9 appearance-none bg-secondary border border-border/50 hover:border-border/80 rounded-lg pl-3 pr-8 text-xs text-foreground outline-none transition-colors cursor-pointer"
              aria-label="Sort performers"
            >
              <option value="count">Most recorded</option>
              <option value="name">A – Z</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none" />
          </div>

          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setGender("");
                setSort("count");
                setPage(1);
              }}
              className="h-9 flex items-center gap-1.5 px-3.5 text-xs text-muted-foreground hover:text-foreground border border-border/50 hover:border-border/80 rounded-lg transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* ── Grid ──────────────────────────────────────── */}
        <div className="relative">
          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 gap-y-6 justify-items-center">
              {Array.from({ length: 27 }).map((_, i) => (
                <div key={i} className="animate-pulse flex flex-col items-center gap-2.5">
                  <div className="w-[76px] h-[76px] sm:w-[86px] sm:h-[86px] rounded-full bg-secondary/40" />
                  <div className="h-2.5 w-16 rounded-full bg-secondary/30" />
                </div>
              ))}
            </div>
          ) : performers.length > 0 ? (
            <>
              <div
                className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 gap-y-6 justify-items-center transition-all duration-300 ${
                  isFetching ? "opacity-40 saturate-50" : ""
                }`}
              >
                {performers.map((perf, i) => (
                  <div
                    key={perf.username}
                    style={{ animationDelay: `${(i % 25) * 15}ms` }}
                    className="animate-fade-in-up"
                  >
                    <PerformerCard performer={perf} variant="circle" fetchPriority={i < 10 ? "high" : undefined} />
                  </div>
                ))}
              </div>

              {isFetching && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/80 backdrop-blur-[2px] transition-all duration-300 pointer-events-none">
                  <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              )}

              {totalPages > 1 && (
                <div className="mt-12 flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                    <span className="tabular-nums">Page {page}</span>
                    <span className="text-border/40">·</span>
                    <span className="tabular-nums">{totalPages}</span> pages
                    <span className="text-border/40">·</span>
                    <span className="tabular-nums">{total.toLocaleString()}</span> performers
                  </div>
                  <div className="w-full max-w-4xl flex justify-center">
                    <AppPagination
                      itemsCount={total}
                      itemsPerPage={ITEMS_PER_PAGE}
                      currentPage={page}
                      onPageChange={handlePageChange}
                      pageRangeDisplayed={5}
                      marginPagesDisplayed={2}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-24 sm:py-32 text-center border border-border/20 rounded-2xl bg-secondary/8">
              <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                <Users className="w-6 h-6 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">No performers match your search.</p>
              <p className="text-xs text-muted-foreground/40 mb-5 max-w-xs mx-auto">
                Try a different name or adjust your filters.
              </p>
              <button
                onClick={() => { setSearch(""); setGender(""); setSort("count"); setPage(1); }}
                className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors"
              >
                <X className="w-3 h-3" />
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
