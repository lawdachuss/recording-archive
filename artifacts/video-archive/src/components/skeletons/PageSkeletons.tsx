import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Skeleton fallbacks for lazy-loaded routes. Each matches the target page's
 * rough layout (grid / detail / profile / auth / admin / simple) so navigating
 * feels instant — the browser shows the page's own skeleton instead of a
 * full-page spinner while the route chunk downloads.
 */

interface SkeletonVideoCardProps {
  className?: string;
}

export function SkeletonVideoCard({ className }: SkeletonVideoCardProps) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <Skeleton className="w-full aspect-video rounded-sm" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

interface PageHeaderSkeletonProps {
  eyebrow?: boolean;
  wideTitle?: boolean;
  className?: string;
}

export function PageHeaderSkeleton({ eyebrow = true, wideTitle = false, className }: PageHeaderSkeletonProps) {
  return (
    <div className={cn("mb-8", className)}>
      {eyebrow && <Skeleton className="h-3 w-24 mb-3" />}
      <Skeleton className={cn("h-8 w-56 mb-2", wideTitle && "w-72")} />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

interface SkeletonGridPageProps {
  count?: number;
  eyebrow?: boolean;
  className?: string;
}

export function SkeletonGridPage({ count = 12, eyebrow = true, className }: SkeletonGridPageProps) {
  return (
    <div className={cn("container mx-auto px-4 sm:px-6 py-10", className)}>
      <PageHeaderSkeleton eyebrow={eyebrow} />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonVideoCard key={i} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonPerformersPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-10">
      <PageHeaderSkeleton eyebrow />
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-y-8 gap-x-2 justify-items-center">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2.5">
            <Skeleton className="w-[72px] h-[72px] rounded-full" />
            <Skeleton className="w-16 h-3" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonDetailPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
      <Skeleton className="h-4 w-32 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <Skeleton className="w-full aspect-video" />
          <div className="flex items-center gap-3 pt-2">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
          <div className="space-y-2 pt-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-sm" />
          ))}
        </div>
      </div>
      <div className="mt-10">
        <Skeleton className="h-4 w-44 mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonVideoCard key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkeletonProfilePage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl">
      <div className="flex items-center gap-4 mb-8">
        <Skeleton className="w-[88px] h-[88px] rounded-full shrink-0" />
        <div className="space-y-2 flex-1 min-w-0">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonVideoCard key={i} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonAuthPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="h-10 w-40 mx-auto" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-3 w-2/3 mx-auto" />
      </div>
    </div>
  );
}

interface SkeletonSimplePageProps {
  rows?: number;
  className?: string;
}

export function SkeletonSimplePage({ rows = 5, className }: SkeletonSimplePageProps) {
  return (
    <div className={cn("container mx-auto px-4 sm:px-6 py-10 max-w-5xl", className)}>
      <PageHeaderSkeleton eyebrow />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className={cn("h-16 w-full rounded-lg", i % 3 === 1 && "h-24")} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonAdminPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl">
      <Skeleton className="h-6 w-64 mb-6" />
      <div className="flex items-center gap-2 mb-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}