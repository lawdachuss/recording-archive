import { useRef, useState, useCallback, useEffect, useMemo } from "react";

function isConnectionConstrained(): boolean {
  const conn = (navigator as any).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  const slow = ["slow-2g", "2g", "3g"];
  return typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType);
}

const preloadCache = new Map<string, HTMLVideoElement | true>();

function preloadVideo(url: string): void {
  if (preloadCache.has(url)) return;
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  preloadCache.set(url, v);
}

interface UseHoverPreviewOptions {
  thumbnailUrl: string | null | undefined;
  previewUrl: string | null | undefined;
  enabled?: boolean;
}

interface UseHoverPreviewReturn {
  isHovered: boolean;
  showVideo: boolean;
  videoUrl: string | null;
  preloadVideoUrl: string | null;
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
  previewUrl,
  enabled = true,
}: UseHoverPreviewOptions): UseHoverPreviewReturn {
  const [isHovered, setIsHovered] = useState(false);
  const intersectionPreloadedRef = useRef(false);
  const enterTimer = useRef<number | null>(null);
  const intentDelay = 90;

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
              if (previewUrl) preloadVideo(previewUrl);
              observer?.disconnect();
              break;
            }
          }
        },
        { rootMargin: "200px" }
      );
      observer.observe(el);
    };
  }, [enabled, previewUrl]);

  const onMouseEnter = useCallback(() => {
    if (!enabled) return;
    if (enterTimer.current) window.clearTimeout(enterTimer.current);
    enterTimer.current = window.setTimeout(() => setIsHovered(true), intentDelay);
  }, [enabled, intentDelay]);

  const onMouseLeave = useCallback(() => {
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    setIsHovered(false);
  }, []);

  const onFocus = useCallback(() => {
    if (!enabled) return;
    setIsHovered(true);
  }, [enabled]);

  const onBlur = useCallback(() => {
    setIsHovered(false);
  }, []);

  useEffect(() => {
    return () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
    };
  }, []);

  // Preload the preview VIDEO while in viewport so playback starts instantly on hover.
  const canPreloadVideo = !!previewUrl && !isConnectionConstrained();
  const preloadVideoUrl = canPreloadVideo ? previewUrl : null;

  // Only .mp4 preview videos are used for hover playback.
  const showVideo = isHovered && !!previewUrl;

  return {
    isHovered,
    showVideo,
    videoUrl: showVideo ? previewUrl : null,
    hoverHandlers: { onMouseEnter, onMouseLeave, onFocus, onBlur },
    viewportRef,
    preloadVideoUrl,
  };
}
