import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { SyncStatusProvider } from "@/contexts/SyncStatusContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { createQueryClient, restoreQueryCache, persistQueryCache } from "@/lib/query-client";
import { initCache } from "@/lib/cache";

// Home is eagerly imported for instant first paint (landing page)
// All other pages are lazy-loaded — fetched on-demand when navigated to
import Home from "@/pages/Home";
const Browse = lazy(() => import("@/pages/Browse"));
const VideoDetail = lazy(() => import("@/pages/VideoDetail"));
const PerformersList = lazy(() => import("@/pages/PerformersList"));
const PerformerProfile = lazy(() => import("@/pages/PerformerProfile"));
const TagsPage = lazy(() => import("@/pages/TagsPage"));
const Bookmarks = lazy(() => import("@/pages/Bookmarks"));
const History = lazy(() => import("@/pages/History"));
const WatchLater = lazy(() => import("@/pages/WatchLater"));
const RandomRedirect = lazy(() => import("@/pages/RandomRedirect"));
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

function Router() {
  return (
    <Suspense fallback={<PageLoading />}>
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
        <Route path="/request">
          <ProtectedRoute><RequestPage /></ProtectedRoute>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  useEffect(() => {
    scheduleIdleWork(() => {
      initCache();
      restoreQueryCache(queryClient);
    });

    const persist = () => persistQueryCache(queryClient);
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);

    return () => {
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
