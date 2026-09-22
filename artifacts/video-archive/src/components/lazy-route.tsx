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
  const Page = lazy(async () => {
    try {
      return await factory();
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (
        msg.includes("dynamically imported module") ||
        msg.includes("text/html") ||
        msg.includes("failed to fetch") ||
        msg.includes("loading chunk")
      ) {
        const reloadKey = "chunk_reload_" + name;
        const lastReload = sessionStorage.getItem(reloadKey);
        const now = Date.now();
        if (!lastReload || now - Number(lastReload) > 10_000) {
          sessionStorage.setItem(reloadKey, String(now));
          window.location.reload();
        }
      }
      throw err;
    }
  });

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