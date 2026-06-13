import { useState, useMemo, useEffect } from "react";
import { useListPerformers } from "@/lib/api";
import { Layout } from "@/components/Layout";
import { PerformerCard } from "@/components/PerformerCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, X, ChevronDown, Loader2 } from "lucide-react";
import { AppPagination } from "@/components/ui/app-pagination";
import type { Performer, PerformersResponse } from "@/lib/api";

type SortOption = "name" | "count";
const ITEMS_PER_PAGE = 56;

export default function PerformersList() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("count");
  const [gender, setGender] = useState("");
  const [page, setPage] = useState(1);

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

  const genders = useMemo(() => {
    if (!performers.length) return [];
    return [...new Set(performers.map((p) => p.gender).filter(Boolean))] as string[];
  }, [performers]);

  const hasFilters = !!(search || gender || sort !== "count");

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <div className="border-b border-border/50 pb-8 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Performers</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isLoading ? "Loading…" : `${total} performers in archive`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                <input
                  type="text"
                  placeholder="Search performer…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="h-8 w-44 bg-secondary/50 border border-border/60 hover:border-border focus:border-primary/50 rounded pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/40"
                  aria-label="Search performers"
                />
                {search && (
                  <button
                    onClick={() => { setSearch(""); setPage(1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Gender filter */}
              {genders.length > 0 && (
                <div className="relative">
                  <select
                    value={gender}
                    onChange={(e) => { setGender(e.target.value); setPage(1); }}
                    className="h-8 appearance-none bg-secondary/50 border border-border/60 hover:border-border rounded pl-3 pr-7 text-xs text-foreground outline-none transition-colors cursor-pointer"
                    aria-label="Filter by gender"
                  >
                    <option value="">All genders</option>
                    {genders.map((g) => (
                      <option key={g} value={g} className="capitalize">
                        {g}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
              )}

              {/* Sort */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => { setSort(e.target.value as SortOption); setPage(1); }}
                  className="h-8 appearance-none bg-secondary/50 border border-border/60 hover:border-border rounded pl-3 pr-7 text-xs text-foreground outline-none transition-colors cursor-pointer"
                  aria-label="Sort performers"
                >
                  <option value="count">Most recordings</option>
                  <option value="name">A – Z</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>

              {hasFilters && (
                <button
                  onClick={() => {
                    setSearch("");
                    setGender("");
                    setSort("count");
                    setPage(1);
                  }}
                  className="h-8 flex items-center gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground border border-border/60 hover:border-border rounded transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-3">
            {Array.from({ length: 56 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : performers.length > 0 ? (
          <>
            <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-3 transition-opacity duration-200 ${isFetching ? "opacity-60" : ""}`}>
              {performers.map((perf) => (
                <PerformerCard key={perf.username} performer={perf} />
              ))}
            </div>
            
            {totalPages > 1 && (
              <div className="mt-8 flex flex-col items-center gap-4">
                <div className="text-xs text-muted-foreground">
                  {isFetching && "Loading… "}Page {page} of {totalPages} · {total.toLocaleString()} performers
                </div>
                <div className="w-full max-w-4xl flex justify-center">
                  <AppPagination
                    itemsCount={total}
                    itemsPerPage={ITEMS_PER_PAGE}
                    currentPage={page}
                    onPageChange={setPage}
                    pageRangeDisplayed={5}
                    marginPagesDisplayed={2}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center border border-border/40 rounded">
            <p className="text-sm text-muted-foreground mb-4">No performers match your search.</p>
            <button
              onClick={() => { setSearch(""); setGender(""); setPage(1); }}
              className="text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
