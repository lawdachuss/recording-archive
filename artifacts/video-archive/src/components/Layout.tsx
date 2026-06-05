import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Search, X, Menu, Sun, Moon, Film, Bookmark, History, Clock, Shuffle, ListVideo, Shield } from "lucide-react";
import { addRecentSearch, getRecentSearches } from "@/lib/bookmarks";

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

  useEffect(() => {
    setMounted(true);
    const hasAgreed = localStorage.getItem("age-gate-passed");
    if (!hasAgreed) setIsOpen(true);
  }, []);

  if (!mounted || !isOpen) return null;

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
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Use
            </Link>
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useDarkMode();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    if (searchOpen) setRecentSearches(getRecentSearches());
  }, [searchOpen]);

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
    setSearchOpen(false);
    setMobileOpen(false);
    setShowSuggestions(false);
    setSearch("");
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

  const iconLinks = [
    { href: "/bookmarks", label: "Bookmarks", Icon: Bookmark },
    { href: "/collections", label: "Collections", Icon: ListVideo },
    { href: "/watch-later", label: "Watch Later", Icon: Clock },
    { href: "/history", label: "History", Icon: History },
    { href: "/admin", label: "Admin", Icon: Shield },
  ];

  const filteredSuggestions = search.trim()
    ? recentSearches.filter((s) => s.toLowerCase().includes(search.toLowerCase())).slice(0, 5)
    : recentSearches.slice(0, 5);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/90 backdrop-blur-xl">
      <div className="container mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/" className="shrink-0 flex items-center gap-1.5 group">
          <Film className="w-4 h-4 text-primary" />
          <span className="font-black text-base tracking-tighter text-foreground group-hover:text-primary transition-colors">
            VAULT
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary mb-0.5" />
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm ml-2">
          {navLinks.map(({ href, label }) => (
            <Link key={href} href={href}>
              <span
                className={`px-3 py-1.5 rounded transition-colors ${
                  isActive(href)
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {searchOpen ? (
            <div className="relative">
              <form onSubmit={handleSearch} className="flex items-center gap-2">
                <div className="relative">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search recordings..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    className="w-48 sm:w-64 h-8 bg-secondary/60 border border-border/60 focus:border-primary/50 rounded px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50"
                  />
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border/60 rounded shadow-lg z-50 overflow-hidden">
                      {filteredSuggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onMouseDown={() => submitSearch(s)}
                          className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors flex items-center gap-2"
                        >
                          <Search className="w-3 h-3 shrink-0" />
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setSearch(""); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close search"
                >
                  <X className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              aria-label="Open search"
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Search</span>
            </button>
          )}

          {/* Icon nav — desktop */}
          {!searchOpen && iconLinks.map(({ href, label, Icon }) => (
            <Link key={href} href={href} title={label}>
              <span
                className={`hidden sm:flex items-center justify-center w-8 h-8 rounded transition-colors ${
                  isActive(href)
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
              </span>
            </Link>
          ))}

          {/* Random button */}
          {!searchOpen && (
            <button
              onClick={() => setLocation("/random")}
              title="Random video"
              className="hidden sm:flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground transition-colors rounded"
              aria-label="Random video"
            >
              <Shuffle className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setDark((d) => !d)}
            className="hidden sm:flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground transition-colors rounded"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            className="flex md:hidden items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/98 backdrop-blur-xl px-4 py-4 space-y-1">
          {[...navLinks, ...iconLinks.map(({ href, label }) => ({ href, label }))].map(({ href, label }) => (
            <Link key={href} href={href}>
              <span
                className={`block px-3 py-2.5 text-sm rounded transition-colors ${
                  isActive(href)
                    ? "text-foreground font-medium bg-secondary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {label}
              </span>
            </Link>
          ))}
          <button
            onClick={() => { setLocation("/random"); setMobileOpen(false); }}
            className="w-full text-left block px-3 py-2.5 text-sm rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors flex items-center gap-2"
          >
            <Shuffle className="w-3.5 h-3.5" />
            Random
          </button>
          <div className="pt-2 border-t border-border/40 flex items-center justify-between px-3 mt-2">
            <span className="text-xs text-muted-foreground">{dark ? "Dark" : "Light"} mode</span>
            <button
              onClick={() => setDark((d) => !d)}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-xs"
            >
              {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              Toggle
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <AgeGate />
      <Navbar />
      <main className="flex-1 flex flex-col">{children}</main>
      <footer className="py-10 border-t border-border/40 mt-16">
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
              <Link href="/admin" className="hover:text-muted-foreground transition-colors">Admin</Link>
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
