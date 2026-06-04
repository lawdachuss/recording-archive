import { useListTags } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Hash } from "lucide-react";

export default function TagsPage() {
  const { data: tags, isLoading } = useListTags();

  // Sort alphabetically for directory view
  const sortedTags = tags ? [...tags].sort((a, b) => a.tag.localeCompare(b.tag)) : [];

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-10 text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-secondary rounded-2xl mb-2">
            <Hash className="w-8 h-8 text-foreground" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Tag Cloud</h1>
          <p className="text-muted-foreground text-lg">
            Explore the archive by categories and content tags.
          </p>
        </div>

        {isLoading ? (
          <div className="flex flex-wrap justify-center gap-3">
            {[...Array(40)].map((_, i) => (
              <Skeleton 
                key={i} 
                className="h-10 rounded-full" 
                style={{ width: `${Math.max(60, Math.random() * 140)}px` }} 
              />
            ))}
          </div>
        ) : sortedTags.length > 0 ? (
          <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-4">
            {sortedTags.map(({ tag, count }) => {
              // Calculate rough visual weight based on count relative to total tags length
              // Just to add some slight variety in size/opacity
              const isPopular = count > 10;
              const isVeryPopular = count > 50;

              return (
                <Link 
                  key={tag} 
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className={`
                    rounded-full border transition-all duration-300 flex items-center
                    hover:border-primary hover:bg-primary/10 hover:text-primary hover:scale-105
                    ${isVeryPopular ? 'text-lg px-5 py-2.5 bg-secondary border-border font-bold' : 
                      isPopular ? 'text-base px-4 py-2 bg-secondary/70 border-border/70 font-semibold' : 
                      'text-sm px-3 py-1.5 bg-secondary/30 border-border/40 font-medium text-muted-foreground hover:text-primary'}
                  `}
                >
                  <span className="opacity-50 mr-1">#</span>{tag} 
                  <span className="ml-2 px-1.5 py-0.5 rounded-full bg-background/50 text-[10px] font-bold opacity-70">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            No tags found in the archive.
          </div>
        )}
      </div>
    </Layout>
  );
}
