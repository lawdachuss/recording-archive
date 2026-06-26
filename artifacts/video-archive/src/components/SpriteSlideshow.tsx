import { useEffect, useRef, useState } from "react";

interface SpriteSlideshowProps {
  spriteUrl: string;
  fps?: number;
  className?: string;
}

interface SpriteLayout {
  cols: number;
  rows: number;
  totalFrames: number;
}

function detectLayout(width: number, height: number): SpriteLayout {
  const candidates = [80, 120, 160, 240, 320];
  for (const fw of candidates) {
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

export function SpriteSlideshow({ spriteUrl, fps = 10, className }: SpriteSlideshowProps) {
  const [layout, setLayout] = useState<SpriteLayout | null>(null);
  const frameRef = useRef(0);
  const styleRef = useRef<React.CSSProperties>({});
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setLayout(detectLayout(img.naturalWidth, img.naturalHeight));
    };
    img.src = spriteUrl;
  }, [spriteUrl]);

  useEffect(() => {
    if (!layout || layout.totalFrames < 2) return;

    const intervalMs = 1000 / fps;
    frameRef.current = 0;

    const update = () => {
      const frame = frameRef.current % layout.totalFrames;
      const col = frame % layout.cols;
      const row = Math.floor(frame / layout.cols);
      styleRef.current = {
        backgroundImage: `url(${spriteUrl})`,
        backgroundSize: `${layout.cols * 100}% auto`,
        backgroundPosition: `${-col * 100}% ${-row * 100}%`,
        backgroundRepeat: "no-repeat",
      };
      forceUpdate((n) => n + 1);
      frameRef.current++;
    };

    update();
    const interval = setInterval(update, intervalMs);
    return () => clearInterval(interval);
  }, [layout, spriteUrl, fps]);

  if (!layout) {
    return (
      <div
        className={className}
        style={{
          backgroundImage: `url(${spriteUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    );
  }

  return <div className={className} style={styleRef.current} />;
}
