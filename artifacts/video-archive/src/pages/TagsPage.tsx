import { useListTags, getListTagsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Tags, Hash } from "lucide-react";

export default function TagsPage() {
  const { data: tags, isLoading } = useListTags({ query: { queryKey: getListTagsQueryKey(), staleTime: 30_000 } });

  const sorted = tags ? [...tags].sort((a, b) => b.count - a.count) : [];
  const maxCount = sorted[0]?.count ?? 1;

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        <div className="mb-10">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <Tags className="w-3.5 h-3.5 text-primary" />
            Tags
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Browse by Tag</h1>
          {tags && (
            <p className="text-sm text-muted-foreground mt-2">{tags.length.toLocaleString()} categories across the archive</p>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-wrap gap-2">
            {[...Array(40)].map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-lg" style={{ width: `${60 + Math.random() * 100}px` }} />
            ))}
          </div>
        ) : sorted.length > 0 ? (
          <div className="flex flex-wrap gap-2 items-baseline">
            {sorted.map(({ tag, count }, index) => {
              const weight = count / maxCount;
              const size = weight > 0.7 ? "text-base font-bold" : weight > 0.4 ? "text-sm font-semibold" : "text-xs font-medium";
              const opacity = weight > 0.5 ? "text-foreground" : weight > 0.2 ? "text-foreground/70" : "text-muted-foreground";
              const padding = weight > 0.7 ? "px-3 py-1.5" : weight > 0.4 ? "px-2.5 py-1" : "px-2 py-0.5";

              return (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className={`inline-flex items-baseline gap-1.5 ${padding} border border-border/40 hover:border-primary/40 hover:bg-primary/5 hover:text-primary rounded-lg transition-all duration-200 animate-fade-in-up ${size} ${opacity}`}
                  style={{ animationDelay: `${index * 15}ms` }}
                >
                  <Hash className={`w-2.5 h-2.5 opacity-40 self-center ${weight > 0.5 ? "inline" : "hidden sm:inline"}`} />
                  {tag}
                  <span className="text-[10px] text-muted-foreground/50 font-normal tabular-nums">{count}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="py-24 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Tags className="w-6 h-6 text-muted-foreground/20" />
            </div>
            <p className="text-sm text-muted-foreground">No tags found.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
