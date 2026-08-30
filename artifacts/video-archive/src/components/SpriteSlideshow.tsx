import { useEffect, useRef, useState, memo, useMemo } from "react";
import { isConnectionConstrained } from "@/lib/connection";
import { dlog, dtick } from "@/lib/debug";

interface SpriteSlideshowProps {
  spriteUrl: string;
  /** Explicit sprite grid columns — skip auto-detection from image dimensions */
  cols?: number;
  /** Explicit sprite grid rows — skip auto-detection from image dimensions */
  rows?: number;
  /** ms each sprite frame is held before advancing (default: 200ms ≈ 5fps) */
  frameMs?: number;
  className?: string;
  active?: boolean;
  /** Fired once the sprite image has actually loaded (first frame paintable) */
  onLoaded?: () => void;
  /** Fired when the sprite image failed to load */
  onError?: () => void;
}

interface SpriteLayout {
  cols: number;
  rows: number;
  totalFrames: number;
}

const KNOWN_LAYOUTS = new Map<string, SpriteLayout>([
  ["2560x1440", { cols: 4, rows: 4, totalFrames: 16 }],
  ["1920x1080", { cols: 4, rows: 4, totalFrames: 16 }],
  ["1280x720", { cols: 4, rows: 4, totalFrames: 16 }],
  ["640x360", { cols: 4, rows: 4, totalFrames: 16 }],
  ["1600x900", { cols: 4, rows: 4, totalFrames: 16 }],
]);

function detectLayout(width: number, height: number): SpriteLayout {
  const key = `${width}x${height}`;
  const known = KNOWN_LAYOUTS.get(key);
  if (known) return known;

  // Fast path: try common grid sizes (4x4, 4x3, 3x3, etc.) first
  const commonGrids: [number, number][] = [
    [4, 4], [4, 3], [3, 4], [3, 3], [5, 4], [4, 5],
    [6, 4], [4, 6], [5, 5], [6, 5], [5, 6], [6, 6],
  ];

  for (const [cols, rows] of commonGrids) {
    if (width % cols === 0 && height % rows === 0) {
      const fw = width / cols;
      const fh = height / rows;
      const ratio = fw / fh;
      // 16:9 frames are the standard
      if (Math.abs(ratio - 16 / 9) < 0.1) {
        return { cols, rows, totalFrames: cols * rows };
      }
    }
  }

  // Fallback: assume 4x4 if divisible, otherwise 1x1
  if (width % 4 === 0 && height % 4 === 0) {
    const fw = width / 4;
    const fh = height / 4;
    if (Math.abs(fw / fh - 16 / 9) < 0.5) {
      return { cols: 4, rows: 4, totalFrames: 16 };
    }
  }

  return { cols: 1, rows: 1, totalFrames: 1 };
}



export const SpriteSlideshow = memo(function SpriteSlideshow({
  spriteUrl,
  cols: explicitCols,
  rows: explicitRows,
  frameMs = 200,
  className,
  active = true,
  onLoaded,
  onError,
}: SpriteSlideshowProps) {
  const [detectedLayout, setDetectedLayout] = useState<SpriteLayout | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const frameRef = useRef(0);
  const divRef = useRef<HTMLDivElement>(null);
  // Keep latest callbacks without re-running the load effect on every render.
  const cbRef = useRef({ onLoaded, onError });
  cbRef.current = { onLoaded, onError };

  // Use explicit layout if provided, otherwise auto-detect from image.
  // Memoized so the object identity is stable across renders — otherwise the
  // animation effect (which depends on `layout`) re-runs and resets the frame
  // counter on every re-render, making the sprite appear to only advance a
  // couple frames then stop instead of looping through the whole sheet.
  const layout: SpriteLayout | null = useMemo(
    () =>
      explicitCols && explicitRows
        ? { cols: explicitCols, rows: explicitRows, totalFrames: explicitCols * explicitRows }
        : detectedLayout,
    [explicitCols, explicitRows, detectedLayout]
  );

  const hasExplicitLayout = !!(explicitCols && explicitRows);

  // Load the sprite image directly for dimension detection. The actual
  // display uses the real spriteUrl (browser HTTP cache + SW serve it fast on
  // repeat visits) — no IDB blob needed.
  useEffect(() => {
    dlog("hoverpreview", "[SpriteSlideshow] mount", { spriteUrl, cols: explicitCols, rows: explicitRows, frameMs });
    setDetectedLayout(null);
    setImageLoaded(false);
    frameRef.current = 0;

    let cancelled = false;

    function finishWithImage(img: HTMLImageElement) {
      if (cancelled) return;
      const detected = hasExplicitLayout ? null : detectLayout(img.naturalWidth, img.naturalHeight);
      if (!hasExplicitLayout) {
        setDetectedLayout(detected);
      }
      dlog("hoverpreview", "[SpriteSlideshow] image loaded", {
        width: img.naturalWidth,
        height: img.naturalHeight,
        explicit: hasExplicitLayout,
        detected,
      });
      setImageLoaded(true);
      cbRef.current.onLoaded?.();
    }

    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => finishWithImage(img);
    img.onerror = () => {
      dlog("hoverpreview", "[SpriteSlideshow] image error", { spriteUrl });
      if (!cancelled) {
        setImageLoaded(true);
        cbRef.current.onError?.();
      }
    };
    img.src = spriteUrl;

    // If already cached by browser HTTP cache, fire immediately
    if (img.complete && img.naturalWidth > 0) {
      finishWithImage(img);
    }

    return () => {
      cancelled = true;
    };
  }, [spriteUrl, hasExplicitLayout]);

  // Reset frame counter when sprite URL changes
  useEffect(() => {
    frameRef.current = 0;
  }, [spriteUrl]);

  // Direct DOM animation — no React state updates per frame
  useEffect(() => {
    const el = divRef.current;
    if (!el || !layout || layout.totalFrames < 2 || !imageLoaded || !active) {
      dlog("hoverpreview", "[SpriteSlideshow] animation skipped", {
        hasEl: !!el,
        layout,
        imageLoaded,
        active,
      });
      return;
    }

    // Don't animate on slow/constrained connections
    if (isConnectionConstrained()) {
      dlog("hoverpreview", "[SpriteSlideshow] animation skipped (connection constrained)");
      return;
    }

    dlog("hoverpreview", "[SpriteSlideshow] animation start", {
      totalFrames: layout.totalFrames,
      cols: layout.cols,
      rows: layout.rows,
      frameMs,
      spriteUrl,
    });

    frameRef.current = 0;
    const bgUrl = `url(${spriteUrl})`;
    const bgSize = `${layout.cols * 100}% ${layout.rows * 100}%`;

    const update = () => {
      const frame = frameRef.current % layout.totalFrames;
      const col = frame % layout.cols;
      const row = Math.floor(frame / layout.cols);
      const x = layout.cols <= 1 ? 0 : (col / (layout.cols - 1)) * 100;
      const y = layout.rows <= 1 ? 0 : (row / (layout.rows - 1)) * 100;
      el.style.backgroundPosition = `${x}% ${y}%`;
      dtick("hoverpreview", `[SpriteSlideshow] frame ${frame}/${layout.totalFrames}`, { x, y });
      frameRef.current++;
    };

    el.style.backgroundImage = bgUrl;
    el.style.backgroundSize = bgSize;
    el.style.backgroundRepeat = "no-repeat";
    el.style.willChange = "background-position";
    update();

    const interval = setInterval(update, frameMs);
    return () => {
      clearInterval(interval);
      dlog("hoverpreview", "[SpriteSlideshow] animation stopped", {
        lastFrame: frameRef.current,
        totalFrames: layout.totalFrames,
      });
    };
  }, [layout, spriteUrl, frameMs, imageLoaded, active]);

  return (
    <div
      ref={divRef}
      className={className}
      style={{
        opacity: active && imageLoaded ? 1 : 0,
        transition: "opacity 0.25s ease",
        contain: "strict",
      }}
    />
  );
});
