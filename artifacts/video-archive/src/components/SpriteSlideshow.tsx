import { useEffect, useRef, useState, memo } from "react";

interface SpriteSlideshowProps {
  spriteUrl: string;
  /** Explicit sprite grid columns — skip auto-detection from image dimensions */
  cols?: number;
  /** Explicit sprite grid rows — skip auto-detection from image dimensions */
  rows?: number;
  /** ms each sprite frame is held before advancing (default: 100ms = 10fps) */
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

function isConnectionConstrained(): boolean {
  try {
    const conn = (navigator as any).connection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const slow = ["slow-2g", "2g", "3g"];
    return typeof conn.effectiveType === "string" && slow.includes(conn.effectiveType);
  } catch {
    return false;
  }
}

export const SpriteSlideshow = memo(function SpriteSlideshow({
  spriteUrl,
  cols: explicitCols,
  rows: explicitRows,
  frameMs = 100,
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

  // Use explicit layout if provided, otherwise auto-detect from image
  const layout: SpriteLayout | null =
    explicitCols && explicitRows
      ? { cols: explicitCols, rows: explicitRows, totalFrames: explicitCols * explicitRows }
      : detectedLayout;

  // Load image for auto-detection only when explicit layout is NOT provided
  useEffect(() => {
    setDetectedLayout(null);
    setImageLoaded(false);
    frameRef.current = 0;

    if (explicitCols && explicitRows) {
      setImageLoaded(true);
    }

    let cancelled = false;
    const img = new Image();
    img.referrerPolicy = "no-referrer";

    img.onload = () => {
      if (cancelled) return;
      if (!explicitCols || !explicitRows) {
        setDetectedLayout(detectLayout(img.naturalWidth, img.naturalHeight));
      }
      setImageLoaded(true);
      cbRef.current.onLoaded?.();
    };
    img.onerror = () => {
      if (cancelled) return;
      setImageLoaded(true);
      cbRef.current.onError?.();
    };
    img.src = spriteUrl;

    // If already cached by browser, fire onload immediately
    if (img.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
      cbRef.current.onLoaded?.();
    }

    return () => {
      cancelled = true;
    };
  }, [spriteUrl, explicitCols, explicitRows]);

  // Reset frame counter when sprite URL changes
  useEffect(() => {
    frameRef.current = 0;
  }, [spriteUrl]);

  // Direct DOM animation — no React state updates per frame
  useEffect(() => {
    const el = divRef.current;
    if (!el || !layout || layout.totalFrames < 2 || !imageLoaded || !active) return;

    // Don't animate on slow/constrained connections
    if (isConnectionConstrained()) return;

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
      frameRef.current++;
    };

    el.style.backgroundImage = bgUrl;
    el.style.backgroundSize = bgSize;
    el.style.backgroundRepeat = "no-repeat";
    el.style.willChange = "background-position";
    update();

    const interval = setInterval(update, frameMs);
    return () => clearInterval(interval);
  }, [layout, spriteUrl, frameMs, imageLoaded, active]);

  return (
    <div
      ref={divRef}
      className={className}
      style={{
        opacity: active && imageLoaded ? 1 : 0,
        transition: "opacity 200ms ease-out",
        contain: "strict",
      }}
    />
  );
});
