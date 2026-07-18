import { useRef, useState, useCallback, useEffect, useMemo } from "react";

const preloadCache = new Map<string, HTMLImageElement | true>();

function preloadAsset(url: string): void {
  if (preloadCache.has(url)) return;
  const img = new Image();
  img.fetchPriority = "high";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.src = url;
  preloadCache.set(url, img);
}

interface UseHoverPreviewOptions {
  thumbnailUrl: string | null | undefined;
  spriteUrl: string | null | undefined;
  previewUrl: string | null | undefined;
  enabled?: boolean;
}

interface UseHoverPreviewReturn {
  isHovered: boolean;
  showVideo: boolean;
  showSprite: boolean;
  videoUrl: string | null;
  hoverHandlers: {
    onMouseEnter: React.MouseEventHandler;
    onMouseLeave: React.MouseEventHandler;
    onFocus: React.FocusEventHandler;
    onBlur: React.FocusEventHandler;
  };
  viewportRef: React.RefCallback<HTMLElement>;
}

export function useHoverPreview({
  thumbnailUrl,
  spriteUrl,
  previewUrl,
  enabled = true,
}: UseHoverPreviewOptions): UseHoverPreviewReturn {
  const [isHovered, setIsHovered] = useState(false);
  const intersectionPreloadedRef = useRef(false);

  const viewportRef = useMemo<React.RefCallback<HTMLElement>>(() => {
    let observer: IntersectionObserver | null = null;
    return (el: HTMLElement | null) => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (!el || !enabled || intersectionPreloadedRef.current) return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !intersectionPreloadedRef.current) {
              intersectionPreloadedRef.current = true;
              if (spriteUrl) preloadAsset(spriteUrl);
              observer?.disconnect();
              break;
            }
          }
        },
        { rootMargin: "200px" }
      );
      observer.observe(el);
    };
  }, [enabled, spriteUrl]);

  const onMouseEnter = useCallback(() => {
    if (!enabled) return;
    setIsHovered(true);
  }, [enabled]);

  const onMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const onFocus = useCallback(() => {
    if (!enabled) return;
    setIsHovered(true);
  }, [enabled]);

  const onBlur = useCallback(() => {
    setIsHovered(false);
  }, []);

  // Priority: video preview > sprite animation
  const showVideo = isHovered && !!previewUrl;
  const showSprite = isHovered && !previewUrl && !!spriteUrl;

  return {
    isHovered,
    showVideo,
    showSprite,
    videoUrl: showVideo ? previewUrl : null,
    hoverHandlers: { onMouseEnter, onMouseLeave, onFocus, onBlur },
    viewportRef,
  };
}
