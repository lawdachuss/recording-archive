import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

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
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
