import { Link } from "wouter";
import { useCallback, memo } from "react";
import { Clapperboard, Users, Tags, BarChart3, Send } from "lucide-react";

export const NAV_LINKS = [
  { href: "/browse", label: "Browse", icon: Clapperboard },
  { href: "/performers", label: "Performers", icon: Users },
  { href: "/tags", label: "Tags", icon: Tags },
  { href: "/charts", label: "Charts", icon: BarChart3 },
  { href: "/request", label: "Request", icon: Send },
] as const;

interface DesktopNavProps {
  location: string;
}

function isActive(href: string, location: string) {
  return href === "/" ? location === "/" : location.startsWith(href);
}

const PAGE_IMPORTS: Record<string, () => Promise<unknown>> = {
  "/browse": () => import("@/pages/Browse"),
  "/performers": () => import("@/pages/PerformersList"),
  "/tags": () => import("@/pages/TagsPage"),
  "/charts": () => import("@/pages/Charts"),
  "/request": () => import("@/pages/RequestPage"),
};

export const DesktopNav = memo(function DesktopNav({ location }: DesktopNavProps) {
  return (
    <nav className="hidden md:flex items-center gap-0.5 text-sm">
      {NAV_LINKS.map(({ href, label, icon: Icon }) => (
        <NavLink key={href} href={href} label={label} icon={Icon} isActive={isActive(href, location)} />
      ))}
    </nav>
  );
});

interface NavLinkProps {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
}

const NavLink = memo(function NavLink({ href, label, icon: Icon, isActive: active }: NavLinkProps) {
  const prefetch = useCallback(() => {
    const imp = PAGE_IMPORTS[href];
    if (imp) imp().catch(() => {});
  }, [href]);

  return (
    <Link href={href}>
      <span
        onMouseEnter={prefetch}
        onFocus={prefetch}
        className={`nav-underline px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all duration-200 ${
          active
            ? "text-foreground font-medium active"
            : "text-muted-foreground/70 hover:text-foreground"
        }`}
      >
        <Icon className={`w-3.5 h-3.5 transition-all duration-200 ${
          active ? "text-primary" : "text-muted-foreground/40 group-hover:text-foreground/60"
        }`} />
        {label}
      </span>
    </Link>
  );
});
