import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  User, Settings, LogOut, Bookmark, Clock, ListVideo, Heart,
  Bell, Shield, ChevronDown, Send,
} from "lucide-react";

export function UserMenu() {
  const { user, signOut, role } = useAuth();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/login">
          <span className="hidden sm:inline-flex items-center h-7 px-3 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/50 hover:border-border rounded-sm transition-all">
            Sign in
          </span>
        </Link>
        <Link href="/signup">
          <span className="hidden sm:inline-flex items-center h-7 px-3 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 rounded-sm transition-colors">
            Sign up
          </span>
        </Link>
        <Link href="/login">
          <span className="sm:hidden flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground transition-colors rounded">
            <User className="w-4 h-4" />
          </span>
        </Link>
      </div>
    );
  }

  const displayName = (user.user_metadata?.username as string) ?? user.email?.split("@")[0] ?? "Account";
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    setLocation("/");
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <div className="w-6 h-6 rounded-full border border-primary/40 flex items-center justify-center text-[10px] font-bold text-primary">
          {initials}
        </div>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 glass-dropdown rounded-sm z-50 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/40">
            <div className="text-xs font-semibold text-foreground truncate">{displayName}</div>
            <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
            {role && role !== "user" && (
              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                <Shield className="w-2.5 h-2.5" />
                {role}
              </span>
            )}
          </div>

          <div className="py-1">
            {[
              { href: "/bookmarks", label: "Bookmarks", Icon: Bookmark },
              { href: "/history", label: "History", Icon: Clock },
              { href: "/watch-later", label: "Watch Later", Icon: ListVideo },
              { href: "/collections", label: "Collections", Icon: ListVideo },
              { href: "/my-requests", label: "My Requests", Icon: Send },
              { href: "/following", label: "Following", Icon: Heart },
              { href: "/notifications", label: "Notifications", Icon: Bell },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href}>
                <span
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {label}
                </span>
              </Link>
            ))}
          </div>

          {(role === "admin" || role === "moderator") && (
            <div className="border-t border-border/40 py-1">
              <Link href="/admin">
                <span
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  Admin panel
                </span>
              </Link>
            </div>
          )}

          <div className="border-t border-border/40 py-1">
            <Link href="/settings">
              <span
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5 shrink-0" />
                Settings
              </span>
            </Link>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
