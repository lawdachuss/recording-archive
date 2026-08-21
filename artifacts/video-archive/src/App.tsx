import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { AlertCircle, RefreshCw } from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { SyncStatusProvider } from "@/contexts/SyncStatusContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { createQueryClient, restoreQueryCache, persistQueryCache } from "@/lib/query-client";
import { initCache } from "@/lib/cache";
import { startCatalogWarmup, onWarmProgress, getWarmProgress } from "@/lib/catalog-warmer";

// Home is eagerly imported for instant first paint (landing page)
// All other pages are lazy-loaded — fetched on-demand when navigated to
import Home from "@/pages/Home";
import RandomRedirect from "@/pages/RandomRedirect";
const Browse = lazy(() => import("@/pages/Browse"));
const VideoDetail = lazy(() => import("@/pages/VideoDetail"));
const PerformersList = lazy(() => import("@/pages/PerformersList"));
const PerformerProfile = lazy(() => import("@/pages/PerformerProfile"));
const TagsPage = lazy(() => import("@/pages/TagsPage"));
const Bookmarks = lazy(() => import("@/pages/Bookmarks"));
const History = lazy(() => import("@/pages/History"));
const WatchLater = lazy(() => import("@/pages/WatchLater"));
const Charts = lazy(() => import("@/pages/Charts"));
const Collections = lazy(() => import("@/pages/Collections"));
const CollectionDetail = lazy(() => import("@/pages/CollectionDetail"));
const AdminPage = lazy(() => import("@/pages/admin"));
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const Settings = lazy(() => import("@/pages/Settings"));
const Following = lazy(() => import("@/pages/Following"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const RequestPage = lazy(() => import("@/pages/RequestPage"));
const MyRequests = lazy(() => import("@/pages/MyRequests"));

const NotFound = lazy(() => import("@/pages/not-found"));

// Full-page spinner for lazy-loading transitions
function PageLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const queryClient = createQueryClient();

function scheduleIdleWork(task: () => void, timeout = 1_500) {
  if (typeof window === "undefined") return;
  const requestIdle = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => {
    const id = window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), timeout);
    return id as unknown as number;
  });
  requestIdle(task, { timeout });
}

// Catalog warmup is handled by catalog-warmer.ts (see App useEffect below).

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

function Router() {
  return (
    <Suspense fallback={<PageLoading />}>
      <GlobalErrorBoundary>
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
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/settings">
          <ProtectedRoute><Settings /></ProtectedRoute>
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
      </GlobalErrorBoundary>
    </Suspense>
  );
}

function App() {
  useEffect(() => {
    scheduleIdleWork(() => {
      initCache();
      restoreQueryCache(queryClient);
    });

    // Catalog warmup: starts 2s after first paint, fetches pages in parallel,
    // and preloads thumbnails → sprites → previews with adaptive concurrency.
    const warmTimer = window.setTimeout(() => {
      scheduleIdleWork(() => startCatalogWarmup(), 1_000);
    }, 2_000);

    const persist = () => persistQueryCache(queryClient);
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);

    return () => {
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
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </SyncStatusProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
