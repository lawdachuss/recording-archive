import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Search, X } from "lucide-react";

export function AgeGate() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const hasAgreed = localStorage.getItem("age-gate-passed");
    if (!hasAgreed) {
      setIsOpen(true);
    }
  }, []);

  if (!mounted || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/98 backdrop-blur-sm">
      <div className="w-full max-w-sm px-8 py-12 text-center">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-6">Age Verification Required</div>
          <div className="text-6xl font-black tracking-tighter text-foreground mb-2">18+</div>
          <div className="w-8 h-px bg-primary mx-auto mb-6" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            This site contains adult material. By entering, you confirm you are 18 years of age or older.
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/browse?search=${encodeURIComponent(search.trim())}`);
      setSearchOpen(false);
    } else {
      setLocation("/browse");
    }
  };

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/90 backdrop-blur-xl">
      <div className="container mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
        <Link href="/" className="shrink-0 flex items-center gap-1 group">
          <span className="font-black text-base tracking-tighter text-foreground group-hover:text-primary transition-colors">
            VAULT
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary mb-0.5" />
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          {[
            { href: "/browse", label: "Browse" },
            { href: "/performers", label: "Performers" },
            { href: "/tags", label: "Tags" },
          ].map(({ href, label }) => (
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

        <div className="flex items-center">
          {searchOpen ? (
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Search recordings..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56 h-8 bg-secondary/60 border border-border/60 focus:border-primary/50 rounded px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Search</span>
            </button>
          )}
        </div>
      </div>
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
        <div className="container mx-auto px-4 sm:px-6 flex items-center justify-between">
          <span className="font-black text-sm tracking-tighter text-foreground/40">
            VAULT<span className="text-primary/40">.</span>
          </span>
          <p className="text-xs text-muted-foreground/50">
            &copy; {new Date().getFullYear()} &mdash; Private Archive
          </p>
        </div>
      </footer>
    </div>
  );
}
