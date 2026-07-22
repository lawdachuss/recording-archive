import { Link } from "wouter";
import { Sun, Moon, Bookmark, FolderOpen, Clock, History, Heart, Bell, Settings, Send } from "lucide-react";
import { NAV_LINKS } from "./DesktopNav";

const LIBRARY_LINKS = [
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
  { href: "/collections", label: "Collections", icon: FolderOpen },
  { href: "/watch-later", label: "Watch Later", icon: Clock },
  { href: "/history", label: "History", icon: History },
  { href: "/my-requests", label: "My Requests", icon: Send },
  { href: "/following", label: "Following", icon: Heart },
] as const;

const SETTINGS_LINKS = [
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface MobileMenuProps {
  open: boolean;
  location: string;
  dark: boolean;
  onDarkToggle: () => void;
  onClose: () => void;
  onRequestOpen?: () => void;
}

function isActive(href: string, location: string) {
  return href === "/" ? location === "/" : location.startsWith(href);
}

export function MobileMenu({
  open,
  location,
  dark,
  onDarkToggle,
  onClose,
  onRequestOpen,
}: MobileMenuProps) {
  return (
    <div
      className={`md:hidden glass-dropdown border-t-0 rounded-b-xl mx-2 mb-2 overflow-hidden ${
        open
          ? "animate-in fade-in slide-in-from-top-1 zoom-in-95 duration-200"
          : "hidden"
      }`}
      style={{ transformOrigin: "top" }}
    >
          {/* Main navigation */}
          <div className="px-3 py-3 space-y-0.5">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <span
                  className={`block px-3 py-2.5 text-sm rounded-lg transition-all duration-150 inline-flex items-center gap-2.5 ${
                    isActive(href, location)
                      ? "text-foreground font-medium bg-secondary/50 dark:bg-white/8"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                  }`}
                  onClick={onClose}
                >
                  <Icon className={`w-4 h-4 ${isActive(href, location) ? "text-primary" : "text-muted-foreground/40"}`} />
                  {label}
                </span>
              </Link>
            ))}
            <button
              onClick={() => { onClose?.(); onRequestOpen?.(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-lg transition-all duration-150 text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
            >
              <Send className="w-4 h-4 text-muted-foreground/40" />
              Request
            </button>
          </div>

          <div className="border-t border-border/30 mx-3" />

          {/* Library section */}
          <div className="px-3 py-2 space-y-0.5">
            <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold">
              Library
            </p>
            {LIBRARY_LINKS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <span
                  className={`block px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center gap-2.5 ${
                    isActive(href, location)
                      ? "text-foreground font-medium bg-secondary/50 dark:bg-white/8"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                  }`}
                  onClick={onClose}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive(href, location) ? "text-primary" : "text-muted-foreground/40"}`} />
                  {label}
                </span>
              </Link>
            ))}
          </div>

          <div className="border-t border-border/30 mx-3" />

          {/* Settings + Random */}
          <div className="px-3 py-2 space-y-0.5">
            {SETTINGS_LINKS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <span
                  className={`block px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center gap-2.5 ${
                    isActive(href, location)
                      ? "text-foreground font-medium bg-secondary/50 dark:bg-white/8"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                  }`}
                  onClick={onClose}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive(href, location) ? "text-primary" : "text-muted-foreground/40"}`} />
                  {label}
                </span>
              </Link>
            ))}
          </div>

          <div className="border-t border-border/30 mx-3" />

          {/* Dark mode toggle */}
          <div className="px-3 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "bg-primary/10" : "bg-amber-500/10"}`}>
                {dark ? (
                  <Sun className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-amber-500" />
                )}
              </div>
              <span className="text-xs text-muted-foreground font-medium">{dark ? "Dark" : "Light"} mode</span>
            </div>
            <button
              onClick={onDarkToggle}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-200 ${
                dark ? "border border-primary/60" : "border border-border/40"
              }`}
              role="switch"
              aria-checked={dark}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-all duration-200 ${
                  dark ? "translate-x-[18px]" : "translate-x-1"
                }`}
              />
            </button>
          </div>
    </div>
  );
}
