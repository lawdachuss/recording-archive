import { useState, useCallback, useEffect, useRef, memo } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  fallback?: React.ReactNode;
  fetchPriority?: "high" | "low" | "auto";
  loading?: "eager" | "lazy";
  noShimmer?: boolean;
}

export const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  className,
  containerClassName,
  fallback,
  fetchPriority,
  loading = "lazy",
  noShimmer = false,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const prevSrcRef = useRef(src);

  // Reset state when src changes (handles list re-ordering / prop changes)
  useEffect(() => {
    if (src !== prevSrcRef.current) {
      setLoaded(false);
      setError(false);
      prevSrcRef.current = src;
    }
  }, [src]);

  const onLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  const onError = useCallback(() => {
    setError(true);
    setLoaded(true);
  }, []);

  if (error) {
    return fallback ?? null;
  }

  return (
    <div className={cn("relative overflow-hidden bg-secondary", containerClassName)}>
      <picture>
        <source srcSet={src} type="image/avif" />
        <source srcSet={src} type="image/webp" />
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          onLoad={onLoad}
          onError={onError}
          className={cn("absolute inset-0 w-full h-full object-cover", className)}
        />
      </picture>
      {!loaded && !noShimmer && (
        <div className="absolute inset-0 z-10 bg-secondary">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_0.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      )}
    </div>
  );
});
