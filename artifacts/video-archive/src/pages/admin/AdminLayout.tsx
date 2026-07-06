import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ListOrdered, Users, Database, ChevronLeft,
  Shield, LogOut, Settings,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/requests", label: "Requests", icon: ListOrdered },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/cache", label: "Cache", icon: Database },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, role, signOut } = useAuth();
  const [location] = useLocation();

  const isActive = (href: string, exact = false) => {
    if (exact) return location === href;
    return location.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="hidden lg:flex lg:flex-col w-64 border-r border-border/40 bg-card/30">
        <div className="p-5">
          <Link href="/admin">
            <div className="flex items-center gap-2.5 cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Shield className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight">Admin</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Control Panel</div>
              </div>
            </div>
          </Link>
        </div>

        <Separator />

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => (
            <Link key={href} href={href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer",
                  isActive(href, exact)
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </div>
            </Link>
          ))}
        </nav>

        <Separator />

        <div className="p-3 space-y-2">
          <Link href="/">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-md hover:bg-accent/50">
              <ChevronLeft className="w-3.5 h-3.5" />
              Back to site
            </div>
          </Link>

          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {user?.email?.charAt(0).toUpperCase() ?? "A"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {user?.email ?? "Admin"}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {role}
              </div>
            </div>
            <button
              onClick={signOut}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen">
        <header className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-border/40 bg-card/20">
          <Link href="/admin">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold">Admin</span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => (
              <Link key={href} href={href}>
                <div
                  className={cn(
                    "p-2 rounded-md transition-colors",
                    isActive(href, exact)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title={label}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </Link>
            ))}
            <div className="w-px h-4 bg-border/50 mx-1" />
            <Link href="/">
              <div className="p-2 text-muted-foreground hover:text-foreground transition-colors" title="Back to site">
                <ChevronLeft className="w-4 h-4" />
              </div>
            </Link>
          </div>
        </header>

        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
