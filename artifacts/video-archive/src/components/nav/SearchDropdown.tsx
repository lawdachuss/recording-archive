import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Search,
  X,
  User,
  Tag,
  Clapperboard,
  TrendingUp,
  Trash2,
  Clock,
} from "lucide-react";
import { addRecentSearch, getRecentSearches, clearRecentSearches } from "@/lib/bookmarks";
import { useSearchSuggestions, useListTags, useListPerformers, type SearchSuggestion } from "@/lib/api";

interface SearchDropdownProps {
  /** Controlled: whether the search bar is expanded */
  open: boolean;
  /** Called when the search opens or closes */
  onOpenChange: (open: boolean) => void;
}

// ── Text highlighting helper ──────────────────────────────

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part)
      ? <strong key={i} className="text-foreground font-semibold">{part}</strong>
      : part,
  );
}

export function SearchDropdown({ open, onOpenChange }: SearchDropdownProps) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounce: wait 250ms after the user stops typing
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch live predictions
  const { data: predictionsData, isLoading: predictionsLoading } =
    useSearchSuggestions(debouncedSearch);
  const predictions = predictionsData?.suggestions ?? [];

  // Trending data for empty-state suggestions (only fetch when search is open)
  const { data: trendingTags } = useListTags();
  const { data: trendingPerformers } = useListPerformers(
    open ? { limit: 5, sort: "count" } : undefined,
    open ? { staleTime: 5 * 60 * 1000 } : undefined,
  );

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [predictions, debouncedSearch]);

  // Load recent searches when search opens
  useEffect(() => {
    if (open) setRecentSearches(getRecentSearches());
  }, [open]);

  // Scroll selected item into view in the suggestions dropdown
  useEffect(() => {
    if (selectedIndex >= 0 && suggestionsRef.current) {
      const items =
        suggestionsRef.current.querySelectorAll<HTMLElement>("[data-index]");
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [open]);

  const submitSearch = useCallback(
    (q: string) => {
      if (q.trim()) {
        addRecentSearch(q.trim());
        setLocation(`/browse?search=${encodeURIComponent(q.trim())}`);
      } else {
        setLocation("/browse");
      }
      closeSearch();
    },
    [setLocation],
  );

  const closeSearch = useCallback(() => {
    onOpenChange(false);
    setSearch("");
    setDebouncedSearch("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, [onOpenChange]);

  const handleClearRecent = useCallback(() => {
    clearRecentSearches();
    setRecentSearches([]);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitSearch(search);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const predictionsCount = predictions.length;
    const recentCount = filteredSuggestions.length;
    const showTrending =
      (search.trim().length === 0 || search.trim().length === 1) && !filteredSuggestions.length;
    const trendingCount = showTrending ? trendingItems.length : 0;

    // Calculate total items: currently visible section
    let totalItems = 0;
    if (search.trim().length >= 2) {
      totalItems = predictionsCount || 1; // at least the "no results" or loading
    } else if (recentCount) {
      totalItems = recentCount + 1; // +1 for clear button
    } else if (trendingCount) {
      totalItems = trendingCount;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
        break;
      case "Enter":
        if (selectedIndex >= 0) {
          e.preventDefault();
          if (search.trim().length >= 2 && predictions[selectedIndex]) {
            const suggestion = predictions[selectedIndex];
            setLocation(suggestion.href);
            closeSearch();
          } else if (recentCount && selectedIndex < recentCount) {
            const recentItem = filteredSuggestions[selectedIndex];
            if (recentItem) submitSearch(recentItem);
          } else if (recentCount && selectedIndex === recentCount) {
            // Clear recent button selected
            handleClearRecent();
          } else if (showTrending && trendingCount && trendingItems[selectedIndex]) {
            const item = trendingItems[selectedIndex];
            if (item?.href) {
              setLocation(item.href);
              closeSearch();
            }
          }
        }
        break;
      case "Escape":
        closeSearch();
        break;
    }
  };

  const filteredSuggestions = search.trim()
    ? recentSearches.filter((s) => s.toLowerCase().includes(search.toLowerCase())).slice(0, 5)
    : recentSearches.slice(0, 5);

  // Build trending items from popular tags and performers
  const trendingItems = useMemo(() => {
    const items: { label: string; href: string; icon: React.ReactNode }[] = [];
    if (trendingTags) {
      for (const t of trendingTags.slice(0, 4)) {
        items.push({
          label: `#${t.tag}`,
          href: `/browse?tags=${encodeURIComponent(t.tag)}`,
          icon: <Tag className="w-3 h-3" />,
        });
      }
    }
    if (trendingPerformers?.performers) {
      for (const p of trendingPerformers.performers.slice(0, 3)) {
        if (items.length >= 7) break;
        items.push({
          label: p.username,
          href: `/performers/${encodeURIComponent(p.username)}`,
          icon: <User className="w-3 h-3" />,
        });
      }
    }
    return items;
  }, [trendingTags, trendingPerformers]);

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        className="nav-btn group"
        aria-label="Open search"
        title="Search"
      >
        <Search className="w-4 h-4 relative z-10" />
      </button>
    );
  }

  return (
    <div className="relative flex items-center">
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            ref={searchInputRef}
            autoFocus
            type="text"
            placeholder="Search recordings, performers, tags..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onKeyDown={handleKeyDown}
            className="w-44 sm:w-64 h-9 pl-8 pr-3 bg-secondary dark:bg-white/[0.08] border border-border/50 focus:border-primary/40 rounded-full text-sm outline-none transition-all placeholder:text-muted-foreground/40"
          />

          {/* Suggestions dropdown */}
          {showSuggestions &&
            (search.trim().length >= 2
              ? renderPredictions({
                  predictionsLoading,
                  predictions,
                  debouncedSearch,
                  search,
                  selectedIndex,
                  suggestionsRef,
                  onSelect: (suggestion) => {
                    setLocation(suggestion.href);
                    closeSearch();
                  },
                  onHover: setSelectedIndex,
                })
              : renderRecentSearches({
                  searches: filteredSuggestions,
                  trendingItems,
                  selectedIndex,
                  onSelect: submitSearch,
                  onNavigate: (href) => { setLocation(href); closeSearch(); },
                  onHover: setSelectedIndex,
                  onClear: handleClearRecent,
                }))}
        </div>
        <button
          type="button"
          onClick={closeSearch}
          className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-white/5 rounded-full transition-all"
          aria-label="Close search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}

// ── Sub-renderers ──────────────────────────────────────────────

interface PredictionsProps {
  predictionsLoading: boolean;
  predictions: SearchSuggestion[];
  debouncedSearch: string;
  search: string;
  selectedIndex: number;
  suggestionsRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (suggestion: SearchSuggestion) => void;
  onHover: (index: number) => void;
}

function renderPredictions({
  predictionsLoading,
  predictions,
  debouncedSearch,
  search,
  selectedIndex,
  suggestionsRef,
  onSelect,
  onHover,
}: PredictionsProps) {
  if (predictionsLoading) {
    return (
      <div className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-4 py-3 text-xs text-muted-foreground/50 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border border-muted-foreground/30 border-t-transparent animate-spin" />
          Searching…
        </div>
      </div>
    );
  }

  if (predictions.length === 0 && debouncedSearch.length >= 2) {
    return (
      <div className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-4 py-3 text-xs text-muted-foreground/50">
          No results for "{debouncedSearch}"
        </div>
      </div>
    );
  }

  if (predictions.length === 0) return null;

  // Group predictions by type
  const groups: {
    type: SearchSuggestion["type"];
    items: SearchSuggestion[];
    label: string;
    icon: React.ReactNode;
  }[] = [];

  const performerItems = predictions.filter((s) => s.type === "performer");
  const recordingItems = predictions.filter((s) => s.type === "recording");
  const tagItems = predictions.filter((s) => s.type === "tag");

  if (performerItems.length) {
    groups.push({
      type: "performer",
      items: performerItems,
      label: "Performers",
      icon: <User className="w-3 h-3" />,
    });
  }
  if (recordingItems.length) {
    groups.push({
      type: "recording",
      items: recordingItems,
      label: "Recordings",
      icon: <Clapperboard className="w-3 h-3" />,
    });
  }
  if (tagItems.length) {
    groups.push({
      type: "tag",
      items: tagItems,
      label: "Tags",
      icon: <Tag className="w-3 h-3" />,
    });
  }

  let idx = 0;

  return (
    <div
      ref={suggestionsRef}
      className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 max-h-[70vh] overflow-y-auto overflow-x-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      {groups.map((group) => (
        <div key={group.type}>
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold bg-secondary dark:bg-white/[0.06]">
            {group.icon}
            {group.label}
          </div>
          {group.items.map((suggestion) => {
            const currentIdx = idx++;
            return (
              <button
                key={`${suggestion.type}-${suggestion.label}`}
                type="button"
                data-index={currentIdx}
                onMouseDown={() => onSelect(suggestion)}
                onMouseEnter={() => onHover(currentIdx)}
                className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center gap-3 ${
                  selectedIndex === currentIdx
                    ? "bg-secondary dark:bg-white/[0.12] text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                }`}
              >
                {suggestion.image_url ? (
                  <div className="w-8 h-8 rounded shrink-0 overflow-hidden bg-secondary">
                    <img
                      src={suggestion.image_url}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ) : suggestion.type === "performer" ? (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-primary/50" />
                  </div>
                ) : suggestion.type === "tag" ? (
                  <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Tag className="w-3.5 h-3.5 text-amber-500/50" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <Clapperboard className="w-3.5 h-3.5 text-primary/50" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {suggestion.type === "tag" && (
                      <span className="text-muted-foreground/50">#</span>
                    )}
                    {highlightMatch(suggestion.label, search)}
                  </div>
                  {suggestion.subtitle && (
                    <div className="truncate text-[10px] text-muted-foreground/40 mt-0.5">
                      {highlightMatch(suggestion.subtitle, search)}
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-muted-foreground/20 shrink-0">↵</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="px-3 py-2 text-[9px] text-muted-foreground/20 text-center border-t border-border/30">
        Press ↵ to search all results
      </div>
    </div>
  );
}

// ── Recent Searches ─────────────────────────────────────────────

interface RecentSearchesProps {
  searches: string[];
  trendingItems: { label: string; href: string; icon: React.ReactNode }[];
  selectedIndex: number;
  onSelect: (query: string) => void;
  onNavigate: (href: string) => void;
  onHover: (index: number) => void;
  onClear: () => void;
}

function renderRecentSearches({
  searches,
  trendingItems,
  selectedIndex,
  onSelect,
  onNavigate,
  onHover,
  onClear,
}: RecentSearchesProps) {
  if (searches.length > 0) {
    return (
      <div className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold bg-secondary dark:bg-white/[0.06]">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Recent Searches
          </div>
          <button
            type="button"
            data-index={searches.length}
            onMouseDown={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onMouseEnter={() => onHover(searches.length)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors ${
              selectedIndex === searches.length
                ? "text-foreground"
                : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
          >
            <Trash2 className="w-2.5 h-2.5" />
            Clear
          </button>
        </div>
        {searches.map((s, i) => (
          <button
            key={s}
            type="button"
            data-index={i}
            onMouseDown={() => onSelect(s)}
            onMouseEnter={() => onHover(i)}
            className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center gap-2 ${
              selectedIndex === i
                ? "bg-secondary/60 dark:bg-white/8 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
            }`}
          >
            <Clock className="w-3 h-3 shrink-0 text-muted-foreground/40" />
            <span className="truncate flex-1">{s}</span>
            <span className="text-[9px] text-muted-foreground/20 shrink-0">↵</span>
          </button>
        ))}
      </div>
    );
  }

  // Trending suggestions when no recent searches
  return (
    <div className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold bg-secondary dark:bg-white/[0.06]">
        <TrendingUp className="w-3 h-3" />
        Trending
      </div>
      {trendingItems.length > 0 ? (
        trendingItems.map((item, i) => (
          <button
            key={item.label}
            type="button"
            data-index={i}
            onMouseDown={() => onNavigate(item.href)}
            onMouseEnter={() => onHover(i)}
            className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center gap-2 ${
              selectedIndex === i
                ? "bg-secondary/60 dark:bg-white/8 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
            }`}
          >
            <div className="w-6 h-6 rounded-full bg-primary/5 flex items-center justify-center shrink-0">
              {item.icon}
            </div>
            <span className="truncate flex-1">{item.label}</span>
          </button>
        ))
      ) : (
        <div className="px-3 py-2 text-[10px] text-muted-foreground/30">
          Type at least 2 characters to search
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-border/30 text-[9px] text-muted-foreground/20 text-center">
Popular tags & performers
      </div>
    </div>
  );
}
