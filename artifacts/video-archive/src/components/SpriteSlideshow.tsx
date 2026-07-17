import { useEffect, useRef, useState, memo } from "react";

interface SpriteSlideshowProps {
  spriteUrl: string;
  fps?: number;
  className?: string;
  active?: boolean;
}

interface SpriteLayout {
  cols: number;
  rows: number;
  totalFrames: number;
}

const FRAME_WIDTH_CANDIDATES = [640, 320, 240, 160, 120, 80];

function detectLayout(width: number, height: number): SpriteLayout {
  for (const fw of FRAME_WIDTH_CANDIDATES) {
    if (width % fw === 0) {
      const cols = width / fw;
      const fh = Math.round(fw * 9 / 16);
      if (height % fh === 0) {
        const rows = height / fh;
        return { cols, rows, totalFrames: cols * rows };
      }
    }
  }
  const cols = 16;
  const fw = width / cols;
  const fh = Math.round(fw * 9 / 16);
  const rows = Math.floor(height / fh);
  return { cols, rows, totalFrames: Math.max(cols * rows, 1) };
}

export const SpriteSlideshow = memo(function SpriteSlideshow({ spriteUrl, fps = 10, className, active = true }: SpriteSlideshowProps) {
  const [layout, setLayout] = useState<SpriteLayout | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const frameRef = useRef(0);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLayout(null);
    setImageLoaded(false);
    frameRef.current = 0;

    let cancelled = false;
    const img = new Image();

    img.onload = () => {
      if (!cancelled) {
        setLayout(detectLayout(img.naturalWidth, img.naturalHeight));
        setImageLoaded(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) setImageLoaded(true);
    };
    img.src = spriteUrl;

    // If already cached by browser, fire onload immediately
    if (img.complete && img.naturalWidth > 0) {
      setLayout(detectLayout(img.naturalWidth, img.naturalHeight));
      setImageLoaded(true);
    }

    return () => {
      cancelled = true;
    };
  }, [spriteUrl]);

  // Direct DOM animation — no React state updates per frame
  useEffect(() => {
    const el = divRef.current;
    if (!el || !layout || layout.totalFrames < 2 || !imageLoaded || !active) return;

    const intervalMs = 1000 / fps;
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
