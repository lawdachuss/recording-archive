import { lazy, Suspense } from "react";
import type { ComponentType, ReactNode } from "react";

/**
 * React.lazy with a per-route Suspense fallback. Since every route gets its own
 * skeleton (matching the target page), a navigation shows the new page's
 * skeleton while its chunk loads instead of the generic full-page spinner.
 */
export function lazyWithSkeleton<P extends object>(
  factory: () => Promise<{ default: ComponentType<P> }>,
  fallback: ReactNode,
  name: string,
): ComponentType<P> {
  const Page = lazy(factory);

  const Wrapped: ComponentType<P> = function LazyRoute(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Page {...props} />
      </Suspense>
    );
  };
  Wrapped.displayName = `Lazy(${name})`;
  return Wrapped;
}