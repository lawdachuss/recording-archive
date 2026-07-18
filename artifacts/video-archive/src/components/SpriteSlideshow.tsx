import { useEffect, useRef, useState, memo } from "react";

interface SpriteSlideshowProps {
  spriteUrl: string;
  /** Explicit sprite grid columns — skip auto-detection from image dimensions */
  cols?: number;
  /** Explicit sprite grid rows — skip auto-detection from image dimensions */
  rows?: number;
  fps?: number;
  /** ms each sprite frame is held before advancing */
  frameMs?: number;
  className?: string;
  active?: boolean;
}

interface SpriteLayout {
  cols: number;
  rows: number;
  totalFrames: number;
}

function detectLayout(width: number, height: number): SpriteLayout {
  // Score each possible grid layout, preferring:
  // - Even division of width and height (no guessing, all integer math)
  // - 16:9 frame aspect ratio (most common for video thumbnails)
  // - Landscape orientation (cols >= rows, typical for sprite grids)
  // - More total frames (gives a richer preview)
  let best: SpriteLayout | null = null;
  let bestScore = -1;

  for (let cols = 1; cols <= 20; cols++) {
    if (width % cols !== 0) continue;
    const fw = width / cols;

    for (let rows = 1; rows <= 20; rows++) {
      if (height % rows !== 0) continue;
      const fh = height / rows;
      if (fh <= 0) continue;

      const ratio = fw / fh;
      const expectedRatio = 16 / 9;
      const ratioDiff = Math.abs(ratio - expectedRatio);

      // Score: aspect ratio match (up to 100pts) + landscape bonus (10pts) + frame count (up to 20pts)
      const aspectScore = ratioDiff < 0.001 ? 100 : Math.max(0, 100 - ratioDiff * 50);
      const orientScore = cols >= rows ? 10 : 5;
      const frameScore = Math.min(cols * rows, 20);

      const score = aspectScore + orientScore + frameScore;

      if (score > bestScore) {
        bestScore = score;
        best = { cols, rows, totalFrames: cols * rows };
      }
    }
  }

  if (best && bestScore > 0) return best;

  // Absolute fallback: treat whole image as one frame
  return { cols: 1, rows: 1, totalFrames: 1 };
}

export const SpriteSlideshow = memo(function SpriteSlideshow({
  spriteUrl,
  cols: explicitCols,
  rows: explicitRows,
  fps = 10,
  frameMs = 40,
  className,
  active = true,
}: SpriteSlideshowProps) {
  const [detectedLayout, setDetectedLayout] = useState<SpriteLayout | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const frameRef = useRef(0);
  const divRef = useRef<HTMLDivElement>(null);

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
      // Layout is known upfront — image will load via CSS background, no JS detection needed
      setImageLoaded(true);
      return;
    }

    let cancelled = false;
    const img = new Image();

    img.onload = () => {
      if (!cancelled) {
        setDetectedLayout(detectLayout(img.naturalWidth, img.naturalHeight));
        setImageLoaded(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) setImageLoaded(true);
    };
    img.src = spriteUrl;

    // If already cached by browser, fire onload immediately
    if (img.complete && img.naturalWidth > 0) {
      setDetectedLayout(detectLayout(img.naturalWidth, img.naturalHeight));
      setImageLoaded(true);
    }

    return () => {
      cancelled = true;
    };
  }, [spriteUrl, explicitCols, explicitRows]);

  // Direct DOM animation — no React state updates per frame
  useEffect(() => {
    const el = divRef.current;
    if (!el || !layout || layout.totalFrames < 2 || !imageLoaded || !active) return;

    const intervalMs = frameMs;
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
    update();

    const interval = setInterval(update, intervalMs);
    return () => clearInterval(interval);
  }, [layout, spriteUrl, fps, imageLoaded, active]);

  return (
    <div
      ref={divRef}
      className={className}
      style={{
        opacity: active && imageLoaded ? 1 : 0,
      }}
    />
  );
});
