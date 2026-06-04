import { useListPerformers } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { PerformerCard } from "@/components/PerformerCard";
import { Skeleton } from "@/components/ui/skeleton";

export default function PerformersList() {
  const { data: performers, isLoading } = useListPerformers();

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10">
        <div className="border-b border-border/50 pb-8 mb-8">
          <h1 className="text-xl font-bold tracking-tight">Performers</h1>
          {performers && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {performers.length} in archive
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-3">
            {[...Array(21)].map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : performers && performers.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 gap-3">
            {performers.map((perf) => (
              <PerformerCard key={perf.username} performer={perf} />
            ))}
          </div>
        ) : (
          <div className="py-20 text-center text-sm text-muted-foreground">
            No performers found.
          </div>
        )}
      </div>
    </Layout>
  );
}
