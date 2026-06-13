import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";

import Home from "@/pages/Home";
import Browse from "@/pages/Browse";
import VideoDetail from "@/pages/VideoDetail";
import PerformersList from "@/pages/PerformersList";
import PerformerProfile from "@/pages/PerformerProfile";
import TagsPage from "@/pages/TagsPage";
import Bookmarks from "@/pages/Bookmarks";
import History from "@/pages/History";
import WatchLater from "@/pages/WatchLater";
import RandomRedirect from "@/pages/RandomRedirect";
import Charts from "@/pages/Charts";
import Collections from "@/pages/Collections";
import CollectionDetail from "@/pages/CollectionDetail";
import RequestPage from "@/pages/RequestPage";
import AdminPage from "@/pages/AdminPage";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import AuthCallback from "@/pages/AuthCallback";
import Settings from "@/pages/Settings";
import Following from "@/pages/Following";
import Notifications from "@/pages/Notifications";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      retryDelay: 500,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/browse" component={Browse} />
      <Route path="/video/:id" component={VideoDetail} />
      <Route path="/performers" component={PerformersList} />
      <Route path="/performers/:username" component={PerformerProfile} />
      <Route path="/tags" component={TagsPage} />
      <Route path="/bookmarks" component={Bookmarks} />
      <Route path="/history" component={History} />
      <Route path="/watch-later" component={WatchLater} />
      <Route path="/random" component={RandomRedirect} />
      <Route path="/charts" component={Charts} />
      <Route path="/collections" component={Collections} />
      <Route path="/collections/:id" component={CollectionDetail} />
      <Route path="/request" component={RequestPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/auth/callback" component={AuthCallback} />
      <Route path="/settings" component={Settings} />
      <Route path="/following" component={Following} />
      <Route path="/notifications" component={Notifications} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
