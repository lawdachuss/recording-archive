import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Search, X, Menu, Sun, Moon, Film, Shuffle, User, Tag, Clapperboard } from "lucide-react";
import { addRecentSearch, getRecentSearches } from "@/lib/bookmarks";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { Pattern } from "@/components/Pattern";
import { useSearchSuggestions, type SearchSuggestion } from "@/lib/api";

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  return [dark, setDark] as const;
}

export function AgeGate() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    setMounted(true);
    const hasAgreed = localStorage.getItem("age-gate-passed");
    if (!hasAgreed) setIsOpen(true);
  }, []);

  if (!mounted || !isOpen) return null;

  if (showTerms) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/98 backdrop-blur-sm">
        <div className="w-full max-w-lg mx-4 px-8 py-12">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-6 text-center">
            Terms of Use
          </div>
          <div className="text-sm text-muted-foreground leading-relaxed space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            <p>
              By accessing this site, you agree to the following terms and conditions. If you do not
              agree with any part of these terms, you must not use this site.
            </p>
            <p>
              <strong>Age Restriction.</strong> This site contains adult content intended for
              individuals who are 18 years of age or older (21 in some jurisdictions). By entering,
              you confirm that you meet the age requirement in your jurisdiction.
            </p>
            <p>
              <strong>Personal Use.</strong> Content on this site is provided for personal,
              non-commercial viewing only. You may not download, redistribute, or reproduce any
              content without explicit permission.
            </p>
            <p>
              <strong>User Conduct.</strong> You agree not to use the site for any unlawful purpose
              or to violate any applicable laws. Harassment, abuse, or harmful behavior toward other
              users will result in account termination.
            </p>
            <p>
              <strong>Privacy.</strong> Your privacy is important to us. Please review our Privacy
              Policy to understand how we collect and handle your data.
            </p>
            <p>
              <strong>Disclaimer.</strong> All content is provided "as is" without warranty of any
              kind. The site operators are not responsible for user-uploaded content or external
              links.
            </p>
            <p>
              <strong>Changes.</strong> These terms may be updated at any time. Continued use of the
              site after changes constitutes acceptance of the new terms.
            </p>
          </div>
          <div className="mt-8 text-center">
            <button
              className="h-10 px-6 border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              onClick={() => setShowTerms(false)}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/98 backdrop-blur-sm">
      <div className="w-full max-w-sm px-8 py-12 text-center">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-6">
            Age Verification Required
          </div>
          <div className="text-6xl font-black tracking-tighter text-foreground mb-2">18+</div>
          <div className="w-8 h-px bg-primary mx-auto mb-6" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            This site contains adult material. By entering, you confirm you are 18 years of age or
            older and agree to our{" "}
            <button
              onClick={() => setShowTerms(true)}
              className="text-primary hover:underline inline cursor-pointer bg-transparent border-none p-0 text-sm"
            >
              Terms of Use
            </button>
            .
          </p>
        </div>
        <div className="space-y-3">
          <button
            className="w-full h-12 bg-primary text-white text-sm font-semibold tracking-wide hover:bg-primary/90 transition-colors"
            onClick={() => {
              localStorage.setItem("age-gate-passed", "true");
              setIsOpen(false);
            }}
          >
            I am 18 or older — Enter
          </button>
          <button
            className="w-full h-12 border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            onClick={() => (window.location.href = "https://google.com")}
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useDarkMode();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounce: wait 250ms after the user stops typing before fetching predictions
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch live predictions
  const { data: predictionsData, isLoading: predictionsLoading } = useSearchSuggestions(debouncedSearch);
  const predictions = predictionsData?.suggestions ?? [];

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [predictions, debouncedSearch]);

  useEffect(() => {
    if (searchOpen) setRecentSearches(getRecentSearches());
  }, [searchOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll selected item into view in the suggestions dropdown
  useEffect(() => {
    if (selectedIndex >= 0 && suggestionsRef.current) {
      const items = suggestionsRef.current.querySelectorAll<HTMLElement>("[data-index]");
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    submitSearch(search);
  };

  const submitSearch = (q: string) => {
    if (q.trim()) {
      addRecentSearch(q.trim());
      setLocation(`/browse?search=${encodeURIComponent(q.trim())}`);
    } else {
      setLocation("/browse");
    }
    closeSearch();
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearch("");
    setDebouncedSearch("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = search.trim().length >= 2 ? predictions.length : recentSearches.slice(0, 5).length;

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
          } else {
            const recentItem = recentSearches.slice(0, 5)[selectedIndex];
            if (recentItem) {
              submitSearch(recentItem);
            }
          }
        }
        break;
      case "Escape":
        closeSearch();
        break;
    }
  };

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  const navLinks = [
    { href: "/browse", label: "Browse" },
    { href: "/performers", label: "Performers" },
    { href: "/tags", label: "Tags" },
    { href: "/charts", label: "Charts" },
    { href: "/request", label: "Request" },
  ];

  const filteredSuggestions = search.trim()
    ? recentSearches.filter((s) => s.toLowerCase().includes(search.toLowerCase())).slice(0, 5)
    : recentSearches.slice(0, 5);

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled ? "glass-panel scrolled" : "glass-panel"
      }`}
    >
      {/* Subtle gradient bottom border accent */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent pointer-events-none" />

      <div className="container mx-auto px-4 sm:px-6 h-14 flex items-center gap-4 relative">
        {/* ─── Logo ─────────────────────────────────────────── */}
        <Link href="/" className="shrink-0 flex items-center gap-2.5 group">
          <div className="relative flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 dark:bg-primary/15 group-hover:bg-primary/20 transition-colors">
            <Film className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="font-black text-lg tracking-tighter text-foreground group-hover:text-primary transition-colors">
              VAULT
            </span>
            <span className="logo-dot w-1.5 h-1.5 rounded-full bg-primary inline-block" />
          </div>
        </Link>

        {/* ─── Divider ──────────────────────────────────────── */}
        <div className="hidden md:block w-px h-6 bg-border/40" />

        {/* ─── Desktop Nav ──────────────────────────────────── */}
        <nav className="hidden md:flex items-center gap-0.5 text-sm">
          {navLinks.map(({ href, label }) => (
            <Link key={href} href={href}>
              <span
                className={`nav-underline px-3 py-1.5 rounded transition-colors ${
                  isActive(href)
                    ? "text-foreground font-medium active"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {/* ─── Right side actions ───────────────────────────── */}
        <div className="flex items-center gap-0.5">
          {searchOpen ? (
            <div className="relative flex items-center">
              <form onSubmit={handleSearch} className="flex items-center gap-1.5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    autoFocus
                    type="text"
                    placeholder="Search recordings..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    onKeyDown={handleKeyDown}
                    className="w-44 sm:w-64 h-9 pl-8 pr-3 bg-secondary/50 dark:bg-white/5 border border-border/50 focus:border-primary/40 rounded-full text-sm outline-none transition-all placeholder:text-muted-foreground/40"
                  />

                  {/* ── Suggestions dropdown ── */}
                  {showSuggestions && (() => {
                    // Mode 1: user has typed 2+ characters → show live predictions
                    if (search.trim().length >= 2) {
                      if (predictionsLoading) {
                        return (
                          <div className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 overflow-hidden">
                            <div className="px-4 py-3 text-xs text-muted-foreground/50 flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full border border-muted-foreground/30 border-t-transparent animate-spin" />
                              Searching…
                            </div>
                          </div>
                        );
                      }
                      if (predictions.length === 0 && debouncedSearch.length >= 2) {
                        return (
                          <div className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 overflow-hidden">
                            <div className="px-4 py-3 text-xs text-muted-foreground/50">
                              No results for "{debouncedSearch}"
                            </div>
                          </div>
                        );
                      }
                      if (predictions.length > 0) {
                        // Group predictions by type
                        const groups: { type: SearchSuggestion["type"]; items: SearchSuggestion[]; label: string; icon: React.ReactNode }[] = [];
                        const performerItems = predictions.filter(s => s.type === "performer");
                        const recordingItems = predictions.filter(s => s.type === "recording");
                        const tagItems = predictions.filter(s => s.type === "tag");

                        let idx = 0;
                        if (performerItems.length) {
                          groups.push({ type: "performer", items: performerItems, label: "Performers", icon: <User className="w-3 h-3" /> });
                        }
                        if (recordingItems.length) {
                          groups.push({ type: "recording", items: recordingItems, label: "Recordings", icon: <Clapperboard className="w-3 h-3" /> });
                        }
                        if (tagItems.length) {
                          groups.push({ type: "tag", items: tagItems, label: "Tags", icon: <Tag className="w-3 h-3" /> });
                        }

                        return (
                          <div ref={suggestionsRef} className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 max-h-[70vh] overflow-y-auto overflow-x-hidden">
                            {groups.map((group) => (
                              <div key={group.type}>
                                <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold bg-secondary/30 dark:bg-white/[0.02]">
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
                                      onMouseDown={() => {
                                        setLocation(suggestion.href);
                                        closeSearch();
                                      }}
                                      onMouseEnter={() => setSelectedIndex(currentIdx)}
                                      className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center gap-3 ${
                                        selectedIndex === currentIdx
                                          ? "bg-secondary/60 dark:bg-white/8 text-foreground"
                                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                                      }`}
                                    >
                                      {/* Thumbnail for performers/recordings */}
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
                                          {suggestion.type === "tag" && <span className="text-muted-foreground/50">#</span>}
                                          {suggestion.label}
                                        </div>
                                        {suggestion.subtitle && (
                                          <div className="truncate text-[10px] text-muted-foreground/40 mt-0.5">
                                            {suggestion.subtitle}
                                          </div>
                                        )}
                                      </div>
                                      {/* Navigate hint */}
                                      <span className="text-[9px] text-muted-foreground/20 shrink-0">
                                        ↵
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return null;
                    }

                    // Mode 2: empty or short query → show recent searches
                    if (filteredSuggestions.length > 0) {
                      return (
                        <div className="absolute top-full left-0 right-0 mt-1.5 glass-dropdown rounded-lg z-50 overflow-hidden">
                          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold bg-secondary/30 dark:bg-white/[0.02]">
                            <Search className="w-3 h-3" />
                            Recent Searches
                          </div>
                          {filteredSuggestions.map((s, i) => (
                            <button
                              key={s}
                              type="button"
                              data-index={i}
                              onMouseDown={() => submitSearch(s)}
                              onMouseEnter={() => setSelectedIndex(i)}
                              className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center gap-2 ${
                                selectedIndex === i
                                  ? "bg-secondary/60 dark:bg-white/8 text-foreground"
                                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                              }`}
                            >
                              <Search className="w-3 h-3 shrink-0 text-muted-foreground/40" />
                              <span className="truncate">{s}</span>
                            </button>
                          ))}
                        </div>
                      );
                    }

                    return null;
                  })()}
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
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="nav-btn group"
              aria-label="Open search"
              title="Search"
            >
              <Search className="w-4 h-4 relative z-10" />
            </button>
          )}

          {!searchOpen && (
            <button
              onClick={() => setLocation("/random")}
              title="Random video"
              className="nav-btn hidden sm:flex"
              aria-label="Random video"
            >
              <Shuffle className="w-4 h-4 relative z-10" />
            </button>
          )}

          {!searchOpen && (
            <button
              onClick={() => setDark((d) => !d)}
              className="nav-btn hidden sm:flex"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              title={dark ? "Light mode" : "Dark mode"}
            >
              <div className="relative z-10">
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </div>
            </button>
          )}

          <NotificationBell />
          <UserMenu />

          <button
            className="flex md:hidden items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-white/5 rounded-full transition-all relative"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ─── Mobile Menu ──────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden glass-dropdown border-t-0 rounded-b-lg mx-2 mb-2 overflow-hidden">
          <div className="px-3 py-3 space-y-0.5">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href}>
                <span
                  className={`nav-underline block px-3 py-2.5 text-sm rounded-lg transition-colors ${
                    isActive(href)
                      ? "text-foreground font-medium bg-secondary/50 dark:bg-white/5 active"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </span>
              </Link>
            ))}
          </div>

          <div className="border-t border-border/30 mx-3" />

          <div className="px-3 py-2 space-y-0.5">
            <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold">
              Library
            </p>
            {[
              { href: "/bookmarks", label: "Bookmarks" },
              { href: "/collections", label: "Collections" },
              { href: "/watch-later", label: "Watch Later" },
              { href: "/history", label: "History" },
              { href: "/following", label: "Following" },
            ].map(({ href, label }) => (
              <Link key={href} href={href}>
                <span
                  className={`block px-3 py-2 text-sm rounded-lg transition-colors ${
                    isActive(href)
                      ? "text-foreground font-medium bg-secondary/50 dark:bg-white/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </span>
              </Link>
            ))}
          </div>

          <div className="border-t border-border/30 mx-3" />

          <div className="px-3 py-2 space-y-0.5">
            {[
              { href: "/notifications", label: "Notifications" },
              { href: "/settings", label: "Settings" },
            ].map(({ href, label }) => (
              <Link key={href} href={href}>
                <span
                  className={`block px-3 py-2 text-sm rounded-lg transition-colors ${
                    isActive(href)
                      ? "text-foreground font-medium bg-secondary/50 dark:bg-white/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </span>
              </Link>
            ))}
            <button
              onClick={() => { setLocation("/random"); setMobileOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5 transition-colors flex items-center gap-2"
            >
              <Shuffle className="w-3.5 h-3.5 text-muted-foreground/50" />
              Random
            </button>
          </div>

          <div className="border-t border-border/30 mx-3" />

          <div className="px-3 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {dark ? (
                <Sun className="w-3.5 h-3.5 text-muted-foreground/50" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-muted-foreground/50" />
              )}
              <span className="text-xs text-muted-foreground">{dark ? "Dark" : "Light"} mode</span>
            </div>
            <button
              onClick={() => setDark((d) => !d)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                dark ? "bg-primary" : "bg-border/60"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                  dark ? "translate-x-[18px]" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background dark:bg-transparent text-foreground flex flex-col font-sans">
      <Pattern />
      <AgeGate />
      <Navbar />
      <main className="flex-1 flex flex-col bg-background/70 dark:bg-transparent">{children}</main>
      <footer className="py-10 border-t border-border/40 mt-16 bg-background/80 dark:bg-background/90">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="space-y-2">
              <Link href="/" className="flex items-center gap-1.5 group w-fit">
                <Film className="w-3.5 h-3.5 text-primary/40 group-hover:text-primary transition-colors" />
                <span className="font-black text-sm tracking-tighter text-foreground/40 group-hover:text-foreground/70 transition-colors">
                  VAULT<span className="text-primary/40">.</span>
                </span>
              </Link>
              <p className="text-xs text-muted-foreground/40 max-w-xs leading-relaxed">
                Private recording archive. For adult audiences only (18+).
              </p>
            </div>
            <nav
              className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground/50"
              aria-label="Footer navigation"
            >
              <Link href="/browse" className="hover:text-muted-foreground transition-colors">Browse</Link>
              <Link href="/performers" className="hover:text-muted-foreground transition-colors">Performers</Link>
              <Link href="/tags" className="hover:text-muted-foreground transition-colors">Tags</Link>
              <Link href="/charts" className="hover:text-muted-foreground transition-colors">Charts</Link>
              <Link href="/collections" className="hover:text-muted-foreground transition-colors">Collections</Link>
              <Link href="/request" className="hover:text-muted-foreground transition-colors">Request</Link>
              <Link href="/bookmarks" className="hover:text-muted-foreground transition-colors">Bookmarks</Link>
              <Link href="/watch-later" className="hover:text-muted-foreground transition-colors">Watch Later</Link>
              <Link href="/history" className="hover:text-muted-foreground transition-colors">History</Link>
              <span className="hidden sm:block w-px h-3 bg-border/40 self-center" />
              <span className="cursor-default">Terms</span>
              <span className="cursor-default">Privacy</span>
            </nav>
          </div>
          <div className="mt-8 pt-5 border-t border-border/30 text-[11px] text-muted-foreground/30">
            &copy; {new Date().getFullYear()} VAULT — Private Archive — Adults only (18+)
          </div>
        </div>
      </footer>
    </div>
  );
}
