import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { Film } from "lucide-react";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-32 text-center relative overflow-hidden">
        <div className="bg-pattern absolute inset-0 pointer-events-none" />
        <Film className="w-10 h-10 text-muted-foreground/20 mb-6" />
        <div className="text-[clamp(4rem,12vw,8rem)] font-black tracking-tighter text-foreground/[0.04] leading-none select-none mb-4">
          404
        </div>
        <h1 className="text-lg font-bold tracking-tight mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-xs">
          The page you're looking for doesn't exist or was removed.
        </p>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="h-9 px-5 border border-primary/30 text-primary text-sm font-medium hover:border-primary/60 transition-colors rounded-sm inline-flex items-center"
          >
            Home
          </Link>
          <Link
            href="/browse"
            className="h-9 px-5 border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors rounded-sm inline-flex items-center"
          >
            Browse
          </Link>
        </div>
      </div>
    </Layout>
  );
}
