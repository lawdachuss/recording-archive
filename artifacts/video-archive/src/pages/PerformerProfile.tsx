import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { useGetPerformer, getGetPerformerQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type PerformerFollow } from "@/lib/user-api";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { AlertCircle, ArrowLeft, Heart, LogIn, Users, Film } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function PerformerProfile() {
  const { username } = useParams<{ username: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const recentlyWatched = useRecentlyWatched();

  const { data: profile, isLoading, isError } = useGetPerformer(username || "", {
    query: {
      enabled: !!username,
      queryKey: getGetPerformerQueryKey(username || ""),
    },
  });

  const { data: follows = [] } = useQuery({
    queryKey: ["user", "follows"],
    queryFn: () => userApi.getFollows(),
    enabled: !!user,
  });

  const isFollowing = follows.some(
    (f: PerformerFollow) => f.performer_username === username,
  );

  const follow = useTrackedMutation({
    mutationFn: () => userApi.addFollow(username!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "follows"] }),
    onError: (err: Error) => {
      toast({ title: "Failed to follow", description: err.message, variant: "destructive" });
    },
  });

  const unfollow = useTrackedMutation({
    mutationFn: () => userApi.removeFollow(username!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "follows"] }),
    onError: (err: Error) => {
      toast({ title: "Failed to unfollow", description: err.message, variant: "destructive" });
    },
  });

  const handleToggleFollow = () => {
    if (!user) {
      toast({ title: "Login required", description: "Sign in to follow performers" });
      setLocation("/login");
      return;
    }
    if (isFollowing) {
      unfollow.mutate();
    } else {
      follow.mutate();
    }
  };

  if (isError) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-20 text-center animate-fade-in-up">
          <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-muted-foreground/30" />
          </div>
          <h1 className="text-xl font-bold mb-2">Performer not found</h1>
          <p className="text-sm text-muted-foreground mb-6">No records for this performer.</p>
          <Link href="/performers" className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors">
            <ArrowLeft className="w-3 h-3" />
            Back to directory
          </Link>
        </div>
      </Layout>
    );
  }

  // Find the best available image across all recordings, trying thumbnail_url → sprite_url → preview_url
  const latestThumbnail = profile?.recordings?.reduce<string | null>((found, rec) => {
    if (found) return found;
    return rec.thumbnail_url || rec.sprite_url || rec.preview_url || null;
  }, null) ?? null;

  return (
    <Layout>
      <div className="relative border-b border-border/50 overflow-hidden bg-gradient-to-b from-secondary/40 to-transparent">
        {/* Background image with parallax-style overlay */}
        {latestThumbnail && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center opacity-[0.06] scale-105"
              style={{ backgroundImage: `url(${latestThumbnail})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </>
        )}
        <div className="relative container mx-auto px-4 sm:px-6 py-12 sm:py-14 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div className="flex items-end gap-5">
            {isLoading ? (
              <Skeleton className="w-20 h-20 rounded-full shrink-0" />
            ) : (
              <div className="w-20 h-20 rounded-full overflow-hidden shrink-0 ring-2 ring-border/60 bg-secondary shadow-lg">
                {latestThumbnail ? (
                  <OptimizedImage
                    src={latestThumbnail}
                    alt={profile?.username ?? ""}
                    className="w-full h-full object-cover object-top"
                    containerClassName="w-full h-full"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center bg-secondary">
                        <span className="text-xl font-black text-muted-foreground/30 uppercase">
                          {username?.slice(0, 2)}
                        </span>
                      </div>
                    }
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-secondary">
                    <span className="text-xl font-black text-muted-foreground/30 uppercase">
                      {username?.slice(0, 2)}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="pb-1">
              <Link
                href="/performers"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <ArrowLeft className="w-3 h-3" /> Performers
              </Link>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-7 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ) : profile ? (
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{profile.username}</h1>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Film className="w-3 h-3 text-muted-foreground/50" />
                      <span className="font-medium tabular-nums">{profile.recording_count || profile.recordings.length}</span> recordings
                    </span>
                    {profile.gender && (
                      <>
                        <span className="w-px h-3 bg-border/40" />
                        <span className="flex items-center gap-1.5 capitalize">
                          <Users className="w-3 h-3 text-muted-foreground/50" />
                          {profile.gender}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {profile && (
            <button
              onClick={handleToggleFollow}
              disabled={follow.isPending || unfollow.isPending}
              className={`inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg border transition-all duration-200 disabled:opacity-60 ${
                user && isFollowing
                  ? "border-primary/60 text-primary hover:border-destructive/40 hover:text-destructive active:scale-95"
                  : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-95"
              }`}
            >
              <Heart className={`w-3.5 h-3.5 transition-all ${user && isFollowing ? "stroke-primary" : ""}`} />
              {!user ? (
                <><LogIn className="w-3 h-3" /> Sign in to Follow</>
              ) : isFollowing ? (
                "Following"
              ) : (
                "Follow"
              )}
            </button>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-10">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8 animate-pulse">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="space-y-2.5">
                <div className="w-full aspect-video rounded-lg bg-secondary/60" />
                <div className="h-3 w-3/4 rounded bg-secondary/40" />
                <div className="h-3 w-1/2 rounded bg-secondary/30" />
              </div>
            ))}
          </div>
        ) : profile?.recordings && profile.recordings.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
            {profile.recordings.map((rec, i) => (
              <div key={rec.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                <VideoCard recording={rec} fetchPriority={i < 2 ? "high" : undefined} isWatched={recentlyWatched.has(rec.id)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Film className="w-6 h-6 text-muted-foreground/20" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">No recordings found for this performer.</p>
            <p className="text-xs text-muted-foreground/40">
              Recordings will appear here once they're archived.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
