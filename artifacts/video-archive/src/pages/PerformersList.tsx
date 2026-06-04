import { useListPerformers } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { PerformerCard } from "@/components/PerformerCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";

export default function PerformersList() {
  const { data: performers, isLoading } = useListPerformers();

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-10 text-center max-w-2xl mx-auto space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-secondary rounded-2xl mb-2">
            <Users className="w-8 h-8 text-foreground" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Performers Directory</h1>
          <p className="text-muted-foreground text-lg">
            Browse all archived performers and their complete collections.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {[...Array(18)].map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-2xl" />
            ))}
          </div>
        ) : performers && performers.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {performers.map(perf => (
              <PerformerCard key={perf.username} performer={perf} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            No performers found in the archive.
          </div>
        )}
      </div>
    </Layout>
  );
}
