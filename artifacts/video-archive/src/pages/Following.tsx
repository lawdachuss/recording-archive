import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type PerformerFollow } from "@/lib/user-api";
import { formatRelativeTime } from "@/lib/formatters";
import { Heart, User2, Trash2, ArrowRight, HeartOff } from "lucide-react";

export default function Following() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const { data: follows = [], isLoading } = useQuery({
    queryKey: ["user", "follows"],
    queryFn: () => userApi.getFollows(),
    enabled: !!user,
  });

  const unfollow = useMutation({
    mutationFn: (username: string) => userApi.removeFollow(username),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "follows"] }),
  });

  if (!user) return null;

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Heart className="w-5 h-5 text-primary" />
              Following
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {follows.length} performer{follows.length !== 1 ? "s" : ""} followed
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-secondary/30 border border-border/30 rounded-sm animate-pulse" />
            ))}
          </div>
        ) : follows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <HeartOff className="w-10 h-10 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground/50 mb-1">Not following anyone</p>
            <p className="text-xs text-muted-foreground/30 mb-6">
              Follow performers from their profile page to see them here.
            </p>
            <Link href="/performers" className="text-xs text-primary hover:underline">
              Browse performers →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {follows.map((f: PerformerFollow) => (
              <div
                key={f.performer_username}
                className="flex items-center gap-3 px-4 py-3 border border-border/40 hover:border-border/70 rounded-sm transition-all group"
              >
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <User2 className="w-4 h-4 text-muted-foreground/50" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{f.performer_username}</div>
                  <div className="text-[11px] text-muted-foreground/60">
                    Following since {formatRelativeTime(f.followed_at)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Link href={`/performers/${f.performer_username}`}>
                    <span className="flex items-center gap-1 h-7 px-2.5 text-[11px] text-muted-foreground hover:text-primary border border-border/40 hover:border-primary/40 rounded-sm transition-all">
                      View <ArrowRight className="w-3 h-3" />
                    </span>
                  </Link>
                  <button
                    onClick={() => unfollow.mutate(f.performer_username)}
                    disabled={unfollow.isPending}
                    className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors rounded"
                    title="Unfollow"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
