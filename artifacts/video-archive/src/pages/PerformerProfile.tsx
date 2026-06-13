import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetPerformer, getGetPerformerQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type PerformerFollow } from "@/lib/user-api";
import { AlertCircle, ArrowLeft, Heart } from "lucide-react";

export default function PerformerProfile() {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

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

  const follow = useMutation({
    mutationFn: () => userApi.addFollow(username!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "follows"] }),
  });

  const unfollow = useMutation({
    mutationFn: () => userApi.removeFollow(username!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "follows"] }),
  });

  const handleToggleFollow = () => {
    if (isFollowing) {
      unfollow.mutate();
    } else {
      follow.mutate();
    }
  };

  if (isError) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-20 text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Performer not found</h1>
          <p className="text-sm text-muted-foreground mb-6">No records for this performer.</p>
          <Link href="/performers" className="text-sm text-primary hover:underline">
            ← Directory
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
      <div className="relative border-b border-border/50 overflow-hidden">
        {latestThumbnail && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-[0.07]"
            style={{ backgroundImage: `url(${latestThumbnail})` }}
          />
        )}
        <div className="relative container mx-auto px-4 sm:px-6 py-10 flex items-end justify-between gap-6">
          <div className="flex items-end gap-6">
            {isLoading ? (
              <Skeleton className="w-20 h-20 rounded-full shrink-0" />
            ) : (
              <div className="w-20 h-20 rounded-full overflow-hidden shrink-0 border-2 border-border bg-secondary">
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

            <div>
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
                  <h1 className="text-2xl font-black tracking-tight">{profile.username}</h1>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{profile.recording_count || profile.recordings.length} recordings</span>
                    {profile.gender && (
                      <>
                        <span className="w-px h-3 bg-border" />
                        <span className="capitalize">{profile.gender}</span>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {user && profile && (
            <button
              onClick={handleToggleFollow}
              disabled={follow.isPending || unfollow.isPending}
              className={`inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-sm border transition-all disabled:opacity-60 ${
                isFollowing
                  ? "bg-primary/10 border-primary/40 text-primary hover:bg-destructive/10 hover:border-destructive/40 hover:text-destructive"
                  : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5"
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isFollowing ? "fill-primary" : ""}`} />
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-10">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-8">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="space-y-2.5">
                <Skeleton className="w-full aspect-video" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : profile?.recordings && profile.recordings.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-8">
            {profile.recordings.map((rec, i) => (
              <VideoCard key={rec.id} recording={rec} fetchPriority={i < 2 ? "high" : undefined} />
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-sm text-muted-foreground border border-border/40">
            No recordings found.
          </div>
        )}
      </div>
    </Layout>
  );
}
