import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SVG_PATH = resolve("artifacts/video-archive/public/favicon.svg");
const OUTPUT_DIR = resolve("artifacts/video-archive/public/icons");

const SIZES = [180, 152, 144, 120, 96, 72, 64, 48, 32, 16];

const svgBuffer = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="#0a0a0a"/>
    <path d="M32 10 L50 19.5 L50 44.5 L32 54 L14 44.5 L14 19.5 Z" 
          fill="none" stroke="#dc2626" stroke-width="2" stroke-linejoin="round" opacity="0.35"/>
    <path d="M20 46 L32 22 L44 46 L38 46 L32 32 L26 46 Z" fill="#dc2626"/>
  </svg>`
);

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toBuffer();

  const outPath = resolve(OUTPUT_DIR, `icon-${size}x${size}.png`);
  writeFileSync(outPath, png);
  console.log(`Generated ${size}x${size} — ${(png.length / 1024).toFixed(1)} KB`);
}

// Also copy as favicon-32x32.png and apple-touch-icon.png at root level
const favicon32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
writeFileSync(resolve("artifacts/video-archive/public", "favicon-32x32.png"), favicon32);

const favicon16 = await sharp(svgBuffer).resize(16, 16).png().toBuffer();
writeFileSync(resolve("artifacts/video-archive/public", "favicon-16x16.png"), favicon16);

const appleIcon180 = await sharp(svgBuffer).resize(180, 180).png().toBuffer();
writeFileSync(resolve("artifacts/video-archive/public", "apple-touch-icon.png"), appleIcon180);

console.log("\nDone! Generated all favicon PNGs.");
