import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  fallback?: React.ReactNode;
  fetchPriority?: "high" | "low" | "auto";
  loading?: "eager" | "lazy";
}

export function OptimizedImage({
  src,
  alt,
  className,
  containerClassName,
  fallback,
  fetchPriority,
  loading = "lazy",
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const prevSrcRef = useRef<string | null>(null);

  // Reset states when src changes so we attempt loading the new image
  useEffect(() => {
    setLoaded(false);
    setError(false);
    prevSrcRef.current = null;
  }, [src]);

  const onLoad = useCallback(() => {
    setLoaded(true);
    prevSrcRef.current = src;
  }, [src]);

  const onError = useCallback(() => {
    setError(true);
    setLoaded(true);
  }, []);

  if (error && !prevSrcRef.current) {
    return fallback ?? null;
  }

  return (
    <div
      className={cn("relative overflow-hidden bg-secondary", containerClassName)}
    >
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        onLoad={onLoad}
        onError={onError}
        className={cn(
          "absolute inset-0 w-full h-full object-cover",
          className,
        )}
      />
      {!loaded && (
        <div className="absolute inset-0 z-10 bg-secondary">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_0.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
      )}
    </div>
  );
}
