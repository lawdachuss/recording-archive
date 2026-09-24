import { isConnectionConstrained } from "@/lib/connection";

/**
 * Central registry of lazily-loaded route chunks. Used by the layout/nav
 * prefetchers AND the route list so there's a single source of truth for the
 * dynamic `import()` fns — hovering/focusing a link and the predictive
 * prefetcher can warm the exact chunk React.lazy would otherwise fetch on
 * navigation.
 *
 * Longest-prefix matching means `/performers/:username` (PerformerProfile)
 * shares the same chunk as `/performers` — prefetching the list warms the
 * profile page too.
 */

const ROUTE_IMPORTS: ReadonlyArray<[string, () => Promise<unknown>]> = [
  ["/video", () => import("@/pages/VideoDetail")],
  ["/browse", () => import("@/pages/Browse")],
  ["/performers", () => import("@/pages/PerformersList")],
  ["/tags", () => import("@/pages/TagsPage")],
  ["/playlists", () => import("@/pages/Playlists")],
  ["/collections", () => import("@/pages/Collections")],
  ["/bookmarks", () => import("@/pages/Bookmarks")],
  ["/watch-later", () => import("@/pages/WatchLater")],
  ["/history", () => import("@/pages/History")],
  ["/analytics", () => import("@/pages/Analytics")],
  ["/request", () => import("@/pages/RequestPage")],
  ["/my-requests", () => import("@/pages/MyRequests")],
  ["/following", () => import("@/pages/Following")],
  ["/notifications", () => import("@/pages/Notifications")],
  ["/settings", () => import("@/pages/Settings")],
  ["/profile", () => import("@/pages/Profile")],
  ["/user", () => import("@/pages/Profile")],
  ["/premium", () => import("@/pages/Premium")],
  ["/login", () => import("@/pages/Login")],
  ["/signup", () => import("@/pages/Signup")],
  ["/forgot-password", () => import("@/pages/ForgotPassword")],
  ["/auth/callback", () => import("@/pages/AuthCallback")],
  ["/admin", () => import("@/pages/admin")],
];

/**
 * Prefetch the JS chunk(s) behind a route. No-op on constrained connections —
 * speculative downloads compete with the current page's thumbnails.
 */
export function prefetchRoute(path: string): void {
  if (isConnectionConstrained()) return;
  const imp = ROUTE_IMPORTS.find(([prefix]) => path.startsWith(prefix))?.[1];
  if (imp) imp().catch(() => {});
}

/** Prefetch several routes (deduplicated by their import fn identity). */
export function prefetchRoutes(paths: string[]): void {
  if (isConnectionConstrained()) return;
  const seen = new Set<() => Promise<unknown>>();
  for (const path of paths) {
    const imp = ROUTE_IMPORTS.find(([prefix]) => path.startsWith(prefix))?.[1];
    if (imp && !seen.has(imp)) {
      seen.add(imp);
      imp().catch(() => {});
    }
  }
}