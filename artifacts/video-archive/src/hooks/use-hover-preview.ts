import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  isVideoUrl,
  isVideoCandidate,
  isAnimatedImageUrl,
  preloadPreviewMedia,
} from "@/lib/preload-preview";
import { preloadImage } from "@/lib/preload-sprite";
import { isConnectionConstrained } from "@/lib/connection";

const DEBUG = false;
function dlog(...args: any[]) { if (DEBUG) console.log("[HoverPreview]", ...args); }



/**
 * Preview URLs reach this hook already routed through the media proxy
 * (`/api/media?url=<encoded>`), which would defeat extension-based type
 * detection. Unwrap the real upstream URL when present so detection stays
 * correct even if the upstream URL carries its own query string.
 */
function getInspectUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith("/api/media")) {
      const inner = parsed.searchParams.get("url");
      if (inner) return inner;
    }
  } catch {
    // Not parseable — fall through to the raw string.
  }
  return url;
}

interface UseHoverPreviewOptions {
  thumbnailUrl: string | null | undefined;
  previewUrl: string | null | undefined;
  /** Sprite sheet URL — preloaded so the frame-by-frame fallback is instant */
  spriteUrl?: string | null;
  enabled?: boolean;
}

interface UseHoverPreviewReturn {
  isHovered: boolean;
  showVideo: boolean;
  showAnimatedImage: boolean;
  videoUrl: string | null;
  animatedImageUrl: string | null;
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
  spriteUrl,
  enabled = true,
}: UseHoverPreviewOptions): UseHoverPreviewReturn {
  dlog("init", { thumbnailUrl, previewUrl, enabled });
  const [isHovered, setIsHovered] = useState(false);
  const intersectionPreloadedRef = useRef(false);
  const enterTimer = useRef<number | null>(null);
  const intentDelay = 90;

  // The URL used for type detection (unwrapped from the proxy), while loading
  // still uses the proxied `previewUrl`.
  const inspectUrl = getInspectUrl(previewUrl);

  // Reset preload flag when the preview or sprite URL changes so the new
  // URL gets preloaded when the card re-enters the viewport.
  useEffect(() => {
    intersectionPreloadedRef.current = false;
  }, [previewUrl, spriteUrl]);

  const viewportRef = useMemo<React.RefCallback<HTMLElement>>(() => {
    let observer: IntersectionObserver | null = null;
    return (el: HTMLElement | null) => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (!el || !enabled || intersectionPreloadedRef.current) return;
      dlog("viewportRef attached", { el });
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !intersectionPreloadedRef.current) {
              intersectionPreloadedRef.current = true;
              // Always preload the sprite — it's the instant hover effect.
              // Also preload the preview media when reachable (skip catbox
              // which blocks datacenter IPs and many residential networks).
              if (spriteUrl) {
                preloadImage(spriteUrl);
              }
              const isCatbox = /catbox\.moe/i.test(previewUrl ?? "");
              if (previewUrl && !isCatbox) {
                preloadPreviewMedia(previewUrl);
              }
              observer?.disconnect();
              break;
            }
          }
        },
        { rootMargin: isConnectionConstrained() ? "200px" : "800px" }
      );
      observer.observe(el);
    };
  }, [enabled, previewUrl, spriteUrl]);

  const onMouseEnter = useCallback(() => {
    dlog("onMouseEnter");
    if (!enabled) return;
    if (enterTimer.current) window.clearTimeout(enterTimer.current);
    enterTimer.current = window.setTimeout(() => {
      dlog("hover timeout -> setIsHovered(true)");
      setIsHovered(true);
    }, intentDelay);
  }, [enabled, intentDelay]);

  const onMouseLeave = useCallback(() => {
    dlog("onMouseLeave");
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    setIsHovered(false);
  }, []);

  const onFocus = useCallback(() => {
    dlog("onFocus");
    if (!enabled) return;
    setIsHovered(true);
  }, [enabled]);

  const onBlur = useCallback(() => {
    dlog("onBlur");
    setIsHovered(false);
  }, []);

  useEffect(() => {
    return () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
    };
  }, []);

  // Preload the preview VIDEO while in viewport so playback starts instantly on hover.
  // Skip entirely on slow connections — the bandwidth is needed for the grid,
  // not speculative video preloads that may never be watched.
  // Only preload actual video files (.mp4, .webm etc.) — .webp files are images
  // and must NOT be loaded into a <video> element (it wastes a connection slot
  // and blocks the <img> from loading).
  const canPreloadVideo = !!previewUrl && isVideoUrl(inspectUrl) && !isConnectionConstrained();
  const preloadVideoUrl = canPreloadVideo ? previewUrl : null;

  // Determine preview type: video, animated WebP, or none. Real video files
  // (.mp4, .webm) are shown via <video>; .webp files are shown via <img>.
  // isVideoCandidate still includes .webp for the showVideo/showAnimatedImage
  // flags (VideoCard uses isWebpPreview to pick the right rendering path).
  const isPreviewVideo = isVideoCandidate(inspectUrl);
  const isAnimatedImage = isAnimatedImageUrl(inspectUrl);
  const showVideo = isHovered && isPreviewVideo;
  const showAnimatedImage = isHovered && isAnimatedImage;

  return {
    isHovered,
    showVideo,
    showAnimatedImage,
    videoUrl: (showVideo ? previewUrl : null) ?? null,
    animatedImageUrl: (showAnimatedImage ? previewUrl : null) ?? null,
    hoverHandlers: { onMouseEnter, onMouseLeave, onFocus, onBlur },
    viewportRef,
    preloadVideoUrl: preloadVideoUrl ?? null,
  };
}
