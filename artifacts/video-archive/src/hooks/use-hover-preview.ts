import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  isVideoUrl,
  isVideoCandidate,
  isAnimatedImageUrl,
  preloadPreviewMedia,
} from "@/lib/preload-preview";
import { preloadImage, isReachablePreviewUrl, isCatboxAnimatedPreviewUrl } from "@/lib/preload-sprite";
import { isConnectionConstrained } from "@/lib/connection";
import { dlog, debugEnabled } from "@/lib/debug";

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
    // wsrv.nl re-encodes media under its own origin (`/?url=<encoded>`).
    // Unwrap so extension-based type detection still works.
    if (parsed.hostname.endsWith("wsrv.nl")) {
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
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

export function useHoverPreview({
  thumbnailUrl,
  previewUrl,
  spriteUrl,
  enabled = true,
}: UseHoverPreviewOptions): UseHoverPreviewReturn {
  if (debugEnabled()) {
    dlog("hoverpreview", "init", { thumbnailUrl, previewUrl, spriteUrl, enabled });
  }
  const [isHovered, setIsHovered] = useState(false);
  const intersectionPreloadedRef = useRef(false);
  const enterTimer = useRef<number | null>(null);
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const intentDelay = 90;

  // The URL used for type detection (unwrapped from the proxy), while loading
  // still uses the proxied `previewUrl`.
  const inspectUrl = getInspectUrl(previewUrl);

  // Reset preload flag when the preview or sprite URL changes so the new
  // URL gets preloaded when the card re-enters the viewport.
  useEffect(() => {
    intersectionPreloadedRef.current = false;
  }, [previewUrl, spriteUrl]);

  useEffect(() => {
    const el = viewportElementRef.current;
    if (!el || !enabled || intersectionPreloadedRef.current) return;

    if (debugEnabled()) {
      dlog("hoverpreview", "viewport attached", { previewUrl, spriteUrl });
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !intersectionPreloadedRef.current) {
            intersectionPreloadedRef.current = true;
            if (spriteUrl && isReachablePreviewUrl(spriteUrl)) {
              preloadImage(spriteUrl, { immediate: true });
            }
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: isConnectionConstrained() ? "200px" : "400px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, previewUrl, spriteUrl]);

  const onMouseEnter = useCallback(() => {
    if (debugEnabled()) dlog("hoverpreview", "onMouseEnter", { enabled, intentDelay });
    if (!enabled) return;
    if (previewUrl && (isReachablePreviewUrl(previewUrl) || isCatboxAnimatedPreviewUrl(previewUrl))) {
      preloadPreviewMedia(previewUrl, true);
    }
    if (enterTimer.current) window.clearTimeout(enterTimer.current);
    enterTimer.current = window.setTimeout(() => {
      if (debugEnabled()) dlog("hoverpreview", "hover timeout -> setIsHovered(true)");
      setIsHovered(true);
    }, intentDelay);
  }, [enabled, intentDelay, previewUrl]);

  const onMouseLeave = useCallback(() => {
    if (debugEnabled()) dlog("hoverpreview", "onMouseLeave");
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    setIsHovered(false);
  }, []);

  const onFocus = useCallback(() => {
    if (debugEnabled()) dlog("hoverpreview", "onFocus");
    if (!enabled) return;
    setIsHovered(true);
  }, [enabled]);

  const onBlur = useCallback(() => {
    if (debugEnabled()) dlog("hoverpreview", "onBlur");
    setIsHovered(false);
  }, []);

  useEffect(() => {
    return () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
    };
  }, []);

  const canPreloadVideo = !!previewUrl && isVideoUrl(inspectUrl) && !isConnectionConstrained();
  const preloadVideoUrl = canPreloadVideo ? previewUrl : null;

  const isPreviewVideo = isVideoCandidate(inspectUrl);
  const isAnimatedImage = isAnimatedImageUrl(inspectUrl);
  const showVideo = isHovered && isPreviewVideo;
  const showAnimatedImage = isHovered && isAnimatedImage;

  useEffect(() => {
    if (!debugEnabled()) return;
    dlog("hoverpreview", "preview path", {
      isHovered,
      inspectUrl,
      type: isPreviewVideo ? "video" : isAnimatedImage ? "webp" : "none",
      showVideo,
      showAnimatedImage,
    });
  }, [isHovered, showVideo, showAnimatedImage, inspectUrl, isPreviewVideo, isAnimatedImage]);

  const hoverHandlers = useMemo(
    () => ({ onMouseEnter, onMouseLeave, onFocus, onBlur }),
    [onMouseEnter, onMouseLeave, onFocus, onBlur]
  );

  return {
    isHovered,
    showVideo,
    showAnimatedImage,
    videoUrl: (showVideo ? previewUrl : null) ?? null,
    animatedImageUrl: (showAnimatedImage ? previewUrl : null) ?? null,
    hoverHandlers,
    viewportRef: viewportElementRef,
    preloadVideoUrl: preloadVideoUrl ?? null,
  };
}
