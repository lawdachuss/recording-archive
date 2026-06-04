import { useParams, Link } from "wouter";
import { useGetPerformer, getGetPerformerQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, Users, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PerformerProfile() {
  const { username } = useParams<{ username: string }>();

  const { data: profile, isLoading, isError } = useGetPerformer(username || "", {
    query: {
      enabled: !!username,
      queryKey: getGetPerformerQueryKey(username || "")
    }
  });

  if (isError) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 text-center">
          <div className="inline-flex items-center justify-center p-4 bg-destructive/10 rounded-full text-destructive mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Performer not found</h1>
          <p className="text-muted-foreground mb-6">We don't have any records for this performer.</p>
          <Link href="/performers">
            <Button variant="outline">Back to Directory</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const latestThumbnail = profile?.recordings?.[0]?.thumbnail_url;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Profile Header */}
        <div className="flex flex-col md:flex-row items-center md:items-end gap-6 mb-12 bg-card p-6 md:p-8 rounded-3xl border border-border/50 relative overflow-hidden">
          {latestThumbnail && (
             <div className="absolute inset-0 bg-cover bg-center blur-3xl opacity-10" style={{ backgroundImage: `url(${latestThumbnail})` }} />
          )}
          
          {isLoading ? (
            <Skeleton className="w-32 h-32 rounded-full shrink-0" />
          ) : (
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-background bg-secondary shrink-0 relative z-10 shadow-2xl">
              {latestThumbnail ? (
                <img src={latestThumbnail} alt={profile.username} className="w-full h-full object-cover object-top" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Users className="w-12 h-12" />
                </div>
              )}
            </div>
          )}

          <div className="flex-1 text-center md:text-left relative z-10">
            {isLoading ? (
              <div className="space-y-3 flex flex-col items-center md:items-start">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-6 w-32" />
              </div>
            ) : profile ? (
              <div>
                <h1 className="text-4xl font-bold tracking-tight mb-2 text-foreground drop-shadow-sm">
                  {profile.username}
                </h1>
                <div className="flex items-center justify-center md:justify-start gap-4 text-muted-foreground">
                  <span className="flex items-center gap-1.5 bg-background/50 backdrop-blur px-3 py-1 rounded-full text-sm font-medium">
                    <Film className="w-4 h-4" />
                    {profile.recording_count || profile.recordings.length} Recordings
                  </span>
                  {profile.gender && (
                    <span className="capitalize bg-background/50 backdrop-blur px-3 py-1 rounded-full text-sm font-medium">
                      {profile.gender}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Recordings Grid */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Collection
          </h2>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 gap-y-10">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="w-full aspect-video rounded-xl" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : profile?.recordings && profile.recordings.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 gap-y-10">
              {profile.recordings.map(rec => (
                <VideoCard key={rec.id} recording={rec} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 border border-border/30 rounded-2xl bg-card/50 text-muted-foreground">
              No recordings found for this performer.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
