import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Search, Film, Users, Hash, PlaySquare } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-md">
      <div className="w-full max-w-md p-8 border border-border/50 bg-card/80 backdrop-blur-xl rounded-2xl shadow-2xl text-center space-y-6 animate-in fade-in zoom-in duration-500">
        <div className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-4">
          <span className="text-3xl font-bold">18+</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Age Verification</h2>
        <p className="text-muted-foreground leading-relaxed">
          This website contains adult material. You must be 18 years of age or older to enter.
        </p>
        <div className="flex gap-4 pt-4">
          <Button 
            variant="outline" 
            className="flex-1 border-muted hover:bg-muted/50"
            onClick={() => window.location.href = "https://google.com"}
          >
            I am under 18
          </Button>
          <Button 
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
            onClick={() => {
              localStorage.setItem("age-gate-passed", "true");
              setIsOpen(false);
            }}
          >
            Enter
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/browse?search=${encodeURIComponent(search.trim())}`);
    } else {
      setLocation('/browse');
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground group-hover:scale-105 transition-transform duration-300">
              <PlaySquare className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight hidden sm:inline-block">
              Archive<span className="text-primary">VR</span>
            </span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1">
            <NavLink href="/" icon={<Film className="w-4 h-4" />}>Home</NavLink>
            <NavLink href="/browse" icon={<Search className="w-4 h-4" />}>Browse</NavLink>
            <NavLink href="/performers" icon={<Users className="w-4 h-4" />}>Performers</NavLink>
            <NavLink href="/tags" icon={<Hash className="w-4 h-4" />}>Tags</NavLink>
          </nav>
        </div>

        <form onSubmit={handleSearch} className="flex-1 max-w-sm relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search recordings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 bg-secondary/50 border border-transparent focus:border-primary/50 focus:bg-secondary/80 rounded-full pl-10 pr-4 text-sm outline-none transition-all duration-300 placeholder:text-muted-foreground/70"
          />
        </form>
      </div>
    </header>
  );
}

function NavLink({ href, children, icon }: { href: string; children: React.ReactNode; icon: React.ReactNode }) {
  const [location] = useLocation();
  const isActive = location === href || (href !== '/' && location.startsWith(href));
  
  return (
    <Link href={href}>
      <span className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive 
          ? "bg-secondary text-foreground" 
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
      }`}>
        {icon}
        {children}
      </span>
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary/30">
      <AgeGate />
      <Navbar />
      <main className="flex-1 flex flex-col relative z-0">
        {children}
      </main>
      <footer className="py-8 border-t border-border/40 mt-12 bg-card/30">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>ArchiveVR &copy; {new Date().getFullYear()}. Premium content archive.</p>
        </div>
      </footer>
    </div>
  );
}
