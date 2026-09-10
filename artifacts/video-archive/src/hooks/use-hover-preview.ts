import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  isVideoUrl,
  isVideoCandidate,
  isAnimatedImageUrl,
  preloadPreviewMedia,
} from "@/lib/preload-preview";
import { preloadImage, isReachablePreviewUrl } from "@/lib/preload-sprite";
import { isConnectionConstrained } from "@/lib/connection";
import { dlog } from "@/lib/debug";



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
    // wsrv.nl re-encodes media under its own origin (`/ ?url=<encoded>`).
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
  viewportRef: React.RefCallback<HTMLElement>;
}

export function useHoverPreview({
  thumbnailUrl,
  previewUrl,
  spriteUrl,
  enabled = true,
}: UseHoverPreviewOptions): UseHoverPreviewReturn {
  dlog("hoverpreview", "init", { thumbnailUrl, previewUrl, spriteUrl, enabled });
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
      dlog("hoverpreview", "viewport attached", { previewUrl, spriteUrl });
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !intersectionPreloadedRef.current) {
              intersectionPreloadedRef.current = true;
              // Preload the sprite (instant hover effect) and the preview
              // media — but ONLY for hosts worth preloading from. catbox
              // throttles third-party hotlinking to ~16KB/s (a 261KB webp
              // takes 16s): a speculative download there never finishes
              // before the hover AND holds a queue slot the whole time,
              // starving the fast proxied hosts (pixhost sprites load in
              // ~250ms through /api/media). catbox sprites/previews load on
              // demand at hover time via useProgressiveImage instead (with
              // its progress bar), and the first hover persists them to the
              // IDB blob cache so repeat hovers are zero-network.
              //
              // In-viewport sprites are marked immediate so they jump ahead
              // of the idle catalog warmer instead of queuing behind it.
              if (spriteUrl && isReachablePreviewUrl(spriteUrl)) {
                preloadImage(spriteUrl, { immediate: true });
              }
              if (previewUrl && isReachablePreviewUrl(previewUrl)) {
                preloadPreviewMedia(previewUrl);
              }
              observer?.disconnect();
              break;
            }
          }
        },
        // Preload only cards close to the viewport. 800px meant a whole grid
        // row of cards fired TWO speculative downloads each on first paint;
        // 400px still starts the fetch well before the pointer arrives while
        // cutting the initial preload burst roughly in half.
        { rootMargin: isConnectionConstrained() ? "200px" : "400px" }
      );
      observer.observe(el);
    };
  }, [enabled, previewUrl, spriteUrl]);

  const onMouseEnter = useCallback(() => {
    dlog("hoverpreview", "onMouseEnter", { enabled, intentDelay });
    if (!enabled) return;
    if (enterTimer.current) window.clearTimeout(enterTimer.current);
    enterTimer.current = window.setTimeout(() => {
      dlog("hoverpreview", "hover timeout -> setIsHovered(true)");
      setIsHovered(true);
    }, intentDelay);
  }, [enabled, intentDelay]);

  const onMouseLeave = useCallback(() => {
    dlog("hoverpreview", "onMouseLeave");
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    setIsHovered(false);
  }, []);

  const onFocus = useCallback(() => {
    dlog("hoverpreview", "onFocus");
    if (!enabled) return;
    setIsHovered(true);
  }, [enabled]);

  const onBlur = useCallback(() => {
    dlog("hoverpreview", "onBlur");
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

  // Log which preview path resolves, so we can correlate with VideoCard.
  useEffect(() => {
    dlog("hoverpreview", "preview path", {
      isHovered,
      inspectUrl,
      type: isPreviewVideo ? "video" : isAnimatedImage ? "webp" : "none",
      showVideo,
      showAnimatedImage,
    });
  }, [isHovered, showVideo, showAnimatedImage, inspectUrl, isPreviewVideo, isAnimatedImage]);


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
