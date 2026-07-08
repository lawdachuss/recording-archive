import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Film, Sun, Moon } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { DesktopNav } from "@/components/nav/DesktopNav";
import { SearchDropdown } from "@/components/nav/SearchDropdown";
import { MobileMenu } from "@/components/nav/MobileMenu";
import RequestDialog from "@/components/RequestDialog";
import { enqueuePrefetch, flushPrefetch } from "@/lib/query-client";

const FOOTER_PAGE_IMPORTS: Record<string, () => Promise<unknown>> = {
  "/browse": () => import("@/pages/Browse"),
  "/performers": () => import("@/pages/PerformersList"),
  "/tags": () => import("@/pages/TagsPage"),
  "/charts": () => import("@/pages/Charts"),
  "/collections": () => import("@/pages/Collections"),
  "/bookmarks": () => import("@/pages/Bookmarks"),
  "/watch-later": () => import("@/pages/WatchLater"),
  "/history": () => import("@/pages/History"),
  "/request": () => import("@/pages/RequestPage"),
};

function prefetchFooter(href: string) {
  const imp = FOOTER_PAGE_IMPORTS[href];
  if (imp) imp().catch(() => {});
}

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

function Logo() {
  return (
    <Link href="/" className="shrink-0 flex items-center gap-2.5 group">
      <div className="relative flex items-center justify-center w-8 h-8 rounded-lg border border-primary/20 group-hover:border-primary/40 transition-all duration-300">
        <Film className="w-4 h-4 text-primary" />
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className="font-black text-xl tracking-tighter text-foreground group-hover:text-primary transition-colors duration-300">
          VAULT
        </span>
        <span className="logo-dot w-1.5 h-1.5 rounded-full bg-primary inline-block" />
      </div>
    </Link>
  );
}

function RandomButton() {
  const [, setLocation] = useLocation();
  return (
    <button
      onClick={() => setLocation("/random")}
      className="random-fab fixed bottom-8 right-8 z-50 cursor-pointer hover:scale-110 active:scale-95 transition-transform duration-200 pointer-events-auto"
      aria-label="Random video"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'hsl(var(--primary))' }}>
        <path d="M10.82 16.12c1.69.6 3.91.79 5.18.85.28.01.53-.09.7-.27"/>
        <path d="M11.14 20.57c.52.24 2.44 1.12 4.08 1.37.46.06.86-.25.9-.71.12-1.52-.3-3.43-.5-4.28"/>
        <path d="M16.13 21.05c1.65.63 3.68.84 4.87.91a.9.9 0 0 0 .7-.26"/>
        <path d="M17.99 5.52a20.83 20.83 0 0 1 3.15 4.5.8.8 0 0 1-.68 1.13c-1.17.1-2.5.02-3.9-.25"/>
        <path d="M20.57 11.14c.24.52 1.12 2.44 1.37 4.08.04.3-.08.59-.31.75"/>
        <path d="M4.93 4.93a10 10 0 0 0-.67 13.4c.35.43.96.4 1.17-.12.69-1.71 1.07-5.07 1.07-6.71 1.34.45 3.1.9 4.88.62a.85.85 0 0 0 .48-.24"/>
        <path d="M5.52 17.99c1.05.95 2.91 2.42 4.5 3.15a.8.8 0 0 0 1.13-.68c.2-2.34-.33-5.3-1.57-8.28"/>
        <path d="M8.35 2.68a10 10 0 0 1 9.98 1.58c.43.35.4.96-.12 1.17-1.5.6-4.3.98-6.07 1.05"/>
        <path d="m2 2 20 20"/>
      </svg>
    </button>
  );
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
            className="w-full h-12 border border-primary/30 text-primary text-sm font-semibold tracking-wide hover:border-primary/60 transition-colors"
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useDarkMode();
  const [scrolled, setScrolled] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled ? "glass-panel scrolled" : "glass-panel"
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/12 to-transparent pointer-events-none" />

      <div className="nav-inner container mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center gap-4 relative transition-all duration-300">
        <Logo />

        <div className="hidden md:block w-px h-5 bg-border/30" />

        <DesktopNav location={location} onRequestOpen={() => setRequestOpen(true)} />

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <SearchDropdown open={searchOpen} onOpenChange={setSearchOpen} />

          {!searchOpen && (
            <button
              onClick={() => setDark((d) => !d)}
              className="nav-btn hidden sm:flex"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              title={dark ? "Light mode" : "Dark mode"}
            >
              <div className="relative z-10 transition-transform duration-200 hover:scale-105">
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
            <div className="relative transition-transform duration-200" style={{ transform: mobileOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </div>
          </button>
        </div>
      </div>

      <MobileMenu
        open={mobileOpen}
        location={location}
        dark={dark}
        onDarkToggle={() => setDark((d) => !d)}
        onClose={() => setMobileOpen(false)}
        onRequestOpen={() => setRequestOpen(true)}
      />
      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </header>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-foreground flex flex-col font-sans">
      <AgeGate />
      <Navbar />
      <main className="flex-1 flex flex-col">
        {children}
      </main>

      <RandomButton />

      <footer className="py-10 border-t border-border/40 mt-16 bg-background dark:bg-background backdrop-blur-sm relative overflow-hidden section-pattern">
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
              <Link href="/browse" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/browse")}>Browse</Link>
              <Link href="/performers" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/performers")}>Performers</Link>
              <Link href="/tags" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/tags")}>Tags</Link>
              <Link href="/charts" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/charts")}>Charts</Link>
              <Link href="/collections" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/collections")}>Collections</Link>
              <Link href="/request" className="hover:text-muted-foreground transition-colors">Request</Link>
              <Link href="/bookmarks" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/bookmarks")}>Bookmarks</Link>
              <Link href="/watch-later" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/watch-later")}>Watch Later</Link>
              <Link href="/history" className="hover:text-muted-foreground transition-colors" onMouseEnter={() => prefetchFooter("/history")}>History</Link>
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
