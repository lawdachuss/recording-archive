import { Component, Suspense, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { AlertCircle, RefreshCw } from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { SyncStatusProvider } from "@/contexts/SyncStatusContext";
import { PremiumProvider } from "@/contexts/PremiumContext";
import { AdsProvider } from "@/contexts/AdsContext";
import { AdPopunder } from "@/components/ads/AdPopunder";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { lazyWithSkeleton } from "@/components/lazy-route";
import { prefetchRoute } from "@/lib/route-chunks";
import {
  SkeletonGridPage,
  SkeletonDetailPage,
  SkeletonPerformersPage,
  SkeletonProfilePage,
  SkeletonAuthPage,
  SkeletonSimplePage,
  SkeletonAdminPage,
} from "@/components/skeletons/PageSkeletons";
import { createQueryClient, restoreQueryCache, persistQueryCache } from "@/lib/query-client";
import { initCache } from "@/lib/cache";
import { startCatalogWarmup } from "@/lib/catalog-warmer";
import { cancelPendingPreviews } from "@/lib/preload-preview";
import { trackActivity } from "@/lib/rum";

// Home is eagerly imported for instant first paint (landing page)
// All other pages are lazy-loaded — fetched on-demand when navigated to.
// Each route shows a skeleton matching its target layout while its chunk
// loads (see components/skeletons/PageSkeletons.tsx), so navigation feels
// instant instead of flashing a generic spinner.
import Home from "@/pages/Home";
import RandomRedirect from "@/pages/RandomRedirect";

const Browse = lazyWithSkeleton(() => import("@/pages/Browse"), <SkeletonGridPage count={12} />, "Browse");
const VideoDetail = lazyWithSkeleton(() => import("@/pages/VideoDetail"), <SkeletonDetailPage />, "VideoDetail");
const PerformersList = lazyWithSkeleton(() => import("@/pages/PerformersList"), <SkeletonPerformersPage />, "PerformersList");
const PerformerProfile = lazyWithSkeleton(() => import("@/pages/PerformerProfile"), <SkeletonProfilePage />, "PerformerProfile");
const TagsPage = lazyWithSkeleton(() => import("@/pages/TagsPage"), <SkeletonGridPage count={24} eyebrow={false} />, "TagsPage");
const Bookmarks = lazyWithSkeleton(() => import("@/pages/Bookmarks"), <SkeletonGridPage count={8} />, "Bookmarks");
const History = lazyWithSkeleton(() => import("@/pages/History"), <SkeletonGridPage count={8} />, "History");
const Analytics = lazyWithSkeleton(() => import("@/pages/Analytics"), <SkeletonSimplePage rows={6} />, "Analytics");
const WatchLater = lazyWithSkeleton(() => import("@/pages/WatchLater"), <SkeletonGridPage count={8} />, "WatchLater");
const Charts = lazyWithSkeleton(() => import("@/pages/Charts"), <SkeletonGridPage count={12} />, "Charts");
const Collections = lazyWithSkeleton(() => import("@/pages/Collections"), <SkeletonGridPage count={8} />, "Collections");
const CollectionDetail = lazyWithSkeleton(() => import("@/pages/CollectionDetail"), <SkeletonGridPage count={12} />, "CollectionDetail");
const AdminPage = lazyWithSkeleton(() => import("@/pages/admin"), <SkeletonAdminPage />, "Admin");
const Login = lazyWithSkeleton(() => import("@/pages/Login"), <SkeletonAuthPage />, "Login");
const Signup = lazyWithSkeleton(() => import("@/pages/Signup"), <SkeletonAuthPage />, "Signup");
const ForgotPassword = lazyWithSkeleton(() => import("@/pages/ForgotPassword"), <SkeletonAuthPage />, "ForgotPassword");
const AuthCallback = lazyWithSkeleton(() => import("@/pages/AuthCallback"), <SkeletonAuthPage />, "AuthCallback");
const Settings = lazyWithSkeleton(() => import("@/pages/Settings"), <SkeletonSimplePage rows={6} />, "Settings");
const Profile = lazyWithSkeleton(() => import("@/pages/Profile"), <SkeletonSimplePage rows={6} />, "Profile");
const Following = lazyWithSkeleton(() => import("@/pages/Following"), <SkeletonGridPage count={8} />, "Following");
const Notifications = lazyWithSkeleton(() => import("@/pages/Notifications"), <SkeletonSimplePage rows={6} />, "Notifications");
const RequestPage = lazyWithSkeleton(() => import("@/pages/RequestPage"), <SkeletonSimplePage rows={6} />, "RequestPage");
const MyRequests = lazyWithSkeleton(() => import("@/pages/MyRequests"), <SkeletonSimplePage rows={6} />, "MyRequests");
const Premium = lazyWithSkeleton(() => import("@/pages/Premium"), <SkeletonSimplePage rows={6} />, "Premium");

const NotFound = lazyWithSkeleton(() => import("@/pages/not-found"), <SkeletonSimplePage rows={3} />, "NotFound");

const queryClient = createQueryClient();

function scheduleIdleWork(task: () => void, timeout = 1_500) {
  if (typeof window === "undefined") return;
  const requestIdle = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => {
    const id = window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), timeout);
    return id as unknown as number;
  });
  requestIdle(task, { timeout });
}

// Global error boundary — catches chunk load errors (auto-reload) and
// rendering errors (shows a friendly recovery UI instead of white-screen).
class GlobalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Chunk load errors from stale deployments — auto-reload silently
    if (error.name === "ChunkLoadError" || error.message?.includes("dynamically imported")) {
      window.location.reload();
      return;
    }
    console.error("[GlobalErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-destructive/60" />
          </div>
          <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-6">
            An unexpected error occurred. Try reloading the page.
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:border-border rounded-lg transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// Fires a page_view activity event on every route change (SPA navigation).
// The full path (including query string) is captured for search/filter routes.
function TrackPageView() {
  const [location] = useLocation();
  useEffect(() => {
    trackActivity("page_view", { meta: { path: location.slice(0, 256) } });
    // Flush queued speculative preview downloads from the previous page so
    // they don't hold the 6 preview slots while the new page loads.
    cancelPendingPreviews();
  }, [location]);
  return null;
}

// Predictive chunk prefetch: warms the most likely NEXT route's JS chunk while
// the current page is idle. From a video page that's Browse; anywhere else it's
// VideoDetail (the dominant destination from every card grid). No-op on
// constrained connections (see lib/route-chunks.ts).
function PredictivePrefetch() {
  const [location] = useLocation();

  useEffect(() => {
    const t = window.setTimeout(
      () =>
        scheduleIdleWork(() => {
          if (location.startsWith("/video/")) {
            prefetchRoute("/browse");
          } else {
            prefetchRoute("/video");
            if (location === "/") prefetchRoute("/browse");
          }
        }, 1_000),
      800,
    );
    return () => window.clearTimeout(t);
  }, [location]);

  return null;
}

function Router() {
  return (
    <GlobalErrorBoundary>
      {/* AdsProvider is OUTSIDE PremiumProvider on purpose: the per-page ad
          switches from Admin → Ads → Placements feed showAds below. */}
      <AdsProvider>
      <PremiumProvider>
      <TrackPageView />
      <PredictivePrefetch />
      <AdPopunder />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/browse" component={Browse} />
        <Route path="/video/:id" component={VideoDetail} />
        <Route path="/performers" component={PerformersList} />
        <Route path="/performers/:username" component={PerformerProfile} />
        <Route path="/tags" component={TagsPage} />
        <Route path="/bookmarks">
          <ProtectedRoute><Bookmarks /></ProtectedRoute>
        </Route>
        <Route path="/history">
          <ProtectedRoute><History /></ProtectedRoute>
        </Route>
        <Route path="/analytics">
          <ProtectedRoute><Analytics /></ProtectedRoute>
        </Route>
        <Route path="/watch-later">
          <ProtectedRoute><WatchLater /></ProtectedRoute>
        </Route>

        <Route path="/random" component={RandomRedirect} />
        <Route path="/charts" component={Charts} />
        <Route path="/collections">
          <ProtectedRoute><Collections /></ProtectedRoute>
        </Route>
        <Route path="/collections/:id">
          <ProtectedRoute><CollectionDetail /></ProtectedRoute>
        </Route>
        <Route path="/admin">
          <ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>
        </Route>
        <Route path="/admin/*">
          <ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>
        </Route>
        <Route path="/premium" component={Premium} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/settings">
          <ProtectedRoute><Settings /></ProtectedRoute>
        </Route>
        <Route path="/profile">
          <ProtectedRoute><Profile /></ProtectedRoute>
        </Route>
        <Route path="/user">
          <ProtectedRoute><Profile /></ProtectedRoute>
        </Route>
        <Route path="/following">
          <ProtectedRoute><Following /></ProtectedRoute>
        </Route>
        <Route path="/notifications">
          <ProtectedRoute><Notifications /></ProtectedRoute>
        </Route>
        <Route path="/my-requests">
          <ProtectedRoute><MyRequests /></ProtectedRoute>
        </Route>
        <Route path="/request">
          <ProtectedRoute><RequestPage /></ProtectedRoute>
        </Route>
        <Route component={NotFound} />
      </Switch>
      </PremiumProvider>
      </AdsProvider>
    </GlobalErrorBoundary>
  );
}

function App() {
  useEffect(() => {
    scheduleIdleWork(() => {
      initCache();
      restoreQueryCache(queryClient);
    });

    // After the first screen settles, speculatively warm the two most common
    // destination chunks (Browse grid + VideoDetail) during idle time. Route
    // hover/focus prefetching covers the rest (DesktopNav/MobileMenu/footer).
    const chunkTimer = window.setTimeout(
      () => scheduleIdleWork(() => { prefetchRoute("/browse"); prefetchRoute("/video"); }, 2_000),
      3_000,
    );

    // Catalog warmup: starts ~20s after first paint (idle-gated) and only
    // warms hover sprites for the catalog's first page. It never runs during
    // initial load — visible thumbnails and the user's first scrolls always
    // get the connection to themselves.
    const warmTimer = window.setTimeout(() => {
      scheduleIdleWork(() => startCatalogWarmup(), 1_000);
    }, 20_000);

    const persist = () => persistQueryCache(queryClient);
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);

    return () => {
      window.clearTimeout(chunkTimer);
      window.clearTimeout(warmTimer);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", persist);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SyncStatusProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Suspense fallback={null}>
                <Router />
              </Suspense>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </SyncStatusProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;