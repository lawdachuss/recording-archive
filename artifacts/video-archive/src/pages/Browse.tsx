import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useListRecordings } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Button } from "@/components/ui/button";
import { Search, Filter, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListRecordingsSort } from "@workspace/api-client-react";

export default function Browse() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const [location, setLocation] = useLocation();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [tags, setTags] = useState(searchParams.get("tags") || "");
  const [gender, setGender] = useState(searchParams.get("gender") || "");
  const [resolution, setResolution] = useState(searchParams.get("resolution") || "");
  const [sort, setSort] = useState<ListRecordingsSort>((searchParams.get("sort") as ListRecordingsSort) || ListRecordingsSort.newest);
  const [allRecordings, setAllRecordings] = useState<any[]>([]);

  const limit = 24;

  const { data, isLoading, isFetching } = useListRecordings({
    page,
    limit,
    search: search || undefined,
    tags: tags || undefined,
    gender: gender || undefined,
    resolution: resolution || undefined,
    sort: sort
  });

  // Reset page and allRecordings when filters change
  useEffect(() => {
    setPage(1);
    setAllRecordings([]);
  }, [searchString]);

  useEffect(() => {
    if (data?.data && page === 1) {
      setAllRecordings(data.data);
    } else if (data?.data && page > 1) {
      setAllRecordings(prev => {
        // filter out duplicates
        const newItems = data.data.filter(rec => !prev.some(p => p.id === rec.id));
        return [...prev, ...newItems];
      });
    }
  }, [data]);

  const updateFilters = (key: string, value: string) => {
    const params = new URLSearchParams(searchString);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Delete page param to reset
    params.delete("page");
    setLocation(`/browse?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters("search", search);
  };

  const hasMore = data ? data.total > allRecordings.length : false;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Browse Archive</h1>
          
          <form onSubmit={handleSearch} className="w-full md:w-auto flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by title or performer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 bg-secondary/50 border border-border/50 focus:border-primary/50 focus:bg-secondary/80 rounded-lg pl-10 pr-4 text-sm outline-none transition-all"
            />
          </form>
        </div>

        {/* Filters */}
        <div className="bg-card border border-border/50 rounded-xl p-4 mb-8 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground mr-2">
            <Filter className="w-4 h-4" />
            <span className="text-sm font-medium">Filters</span>
          </div>

          <Select value={sort} onValueChange={(val: any) => updateFilters("sort", val)}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="largest">Largest Files</SelectItem>
            </SelectContent>
          </Select>

          <Select value={gender} onValueChange={(val) => updateFilters("gender", val === "all" ? "" : val)}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Genders</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="couple">Couple</SelectItem>
            </SelectContent>
          </Select>

          <Select value={resolution} onValueChange={(val) => updateFilters("resolution", val === "all" ? "" : val)}>
            <SelectTrigger className="w-[130px] h-9">
              <SelectValue placeholder="Resolution" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Res</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="540p">540p</SelectItem>
              <SelectItem value="360p">360p</SelectItem>
            </SelectContent>
          </Select>

          {tags && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-md text-sm border border-primary/20">
              <span className="font-semibold">Tag:</span> {tags}
              <button 
                onClick={() => updateFilters("tags", "")}
                className="ml-2 hover:text-white"
              >
                &times;
              </button>
            </div>
          )}
        </div>

        {/* Grid */}
        {isLoading && page === 1 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 gap-y-10">
            {[...Array(15)].map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="w-full aspect-video rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : allRecordings.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 gap-y-10">
              {allRecordings.map(rec => (
                <VideoCard key={rec.id} recording={rec} />
              ))}
            </div>

            {hasMore && (
              <div className="mt-12 flex justify-center">
                <Button 
                  size="lg" 
                  variant="outline"
                  className="w-full max-w-sm rounded-full border-border/50 hover:bg-secondary"
                  onClick={() => setPage(p => p + 1)}
                  disabled={isFetching}
                >
                  {isFetching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {isFetching ? "Loading..." : "Load More"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-32 border border-border/30 rounded-2xl bg-card/50">
            <h3 className="text-xl font-semibold mb-2">No recordings found</h3>
            <p className="text-muted-foreground mb-6">Try adjusting your filters or search query.</p>
            <Button onClick={() => setLocation('/browse')} variant="outline">
              Clear Filters
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
