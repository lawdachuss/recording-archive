import { useListTags } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function TagsPage() {
  const { data: tags, isLoading } = useListTags({ query: { staleTime: 30_000 } } as any);

  const sorted = tags ? [...tags].sort((a, b) => b.count - a.count) : [];
  const maxCount = sorted[0]?.count ?? 1;

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        <div className="border-b border-border/50 pb-8 mb-10">
          <h1 className="text-xl font-bold tracking-tight">Tags</h1>
          {tags && (
            <p className="text-xs text-muted-foreground mt-0.5">{tags.length} categories</p>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-wrap gap-2">
            {[...Array(40)].map((_, i) => (
              <Skeleton key={i} className="h-7 rounded-sm" style={{ width: `${60 + Math.random() * 80}px` }} />
            ))}
          </div>
        ) : sorted.length > 0 ? (
          <div className="flex flex-wrap gap-2 items-baseline">
            {sorted.map(({ tag, count }) => {
              const weight = count / maxCount;
              const size = weight > 0.7 ? "text-base font-bold" : weight > 0.4 ? "text-sm font-semibold" : "text-xs font-medium";
              const opacity = weight > 0.5 ? "text-foreground" : weight > 0.2 ? "text-foreground/70" : "text-muted-foreground";

              return (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className={`inline-flex items-baseline gap-1 px-2.5 py-1 border border-border/40 hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all ${size} ${opacity}`}
                >
                  {tag}
                  <span className="text-[10px] text-muted-foreground/50 font-normal">{count}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="py-20 text-center text-sm text-muted-foreground">
            No tags found.
          </div>
        )}
      </div>
    </Layout>
  );
}
