/**
 * ad-creatives.ts — file-driven ad creative loader & rotator.
 *
 * Every `.txt` file in the app's `/ads` folder is compiled into the bundle
 * as a raw string (Vite `import.meta.glob` … `?raw`). Ad slots reference
 * these files by name (dimensions are parsed from the file name, e.g.
 * `leaderboard-728x90.txt` → 728 × 90).
 *
 * A file can hold ONE OR MANY creatives:
 *   - creatives are separated by a line containing only three dashes:  ---
 *   - blocks that contain nothing but HTML comments are ignored (so the
 *     instruction headers shipped with each file never render)
 *   - banner slots start at a RANDOM creative and rotate through the rest
 *     every 20s (see components/ads/AdBanner.tsx)
 *   - global slots (popunder) inject ONE random creative once per page load
 *
 * Paste CrakRevenue's HTML or JS codes
 * straight into the files — <script>, <iframe>, <a><img></a> all work.
 * Editing a file requires a rebuild/redeploy (codes are baked at build).
 *
 * Ad rendering is gated client-side by PremiumContext `showAds`
 * (age gate passed, not premium, route not excluded).
 */

const globbedFiles = import.meta.glob<string>("../../ads/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Slot files only — README.txt documents the folder and is never a slot. */
const rawFiles = Object.fromEntries(
  Object.entries(globbedFiles).filter(([key]) => !key.endsWith("/README.txt"))
) as Record<string, string>;

/** A line containing only three-or-more dashes separates creatives. */
const SEPARATOR = /^\s*-{3,}\s*$/m;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/** A line that contains nothing but a URL (common way to paste banner GIFs). */
const BARE_URL = /^https?:\/\/\S+$/i;
const IMAGE_EXT = /\.(gif|jpe?g|png|webp|avif|bmp)(\?|#|$)/i;

/**
 * Turn a bare image URL into an <img> creative sized for the slot;
 * non-image URLs (smartlinks etc.) don't belong in banner slots → null
 * (paste those into ads/direct-link.txt instead).
 */
export function bareUrlToMarkup(url: string, width: number, height: number): string | null {
  if (!IMAGE_EXT.test(url)) return null;
  const safe = url.replace(/"/g, "&quot;");
  return (
    `<img src="${safe}" alt="Advertisement" width="${width}" height="${height}" ` +
    `style="display:block;max-width:100%;height:auto;margin:0 auto;" />`
  );
}

/**
 * One `---`-separated block → zero or more creatives.
 * - HTML comments are stripped (instruction headers never render)
 * - a line that is ONLY a URL becomes its own rotating creative
 *   (image URLs → sized <img>; other URLs are skipped here)
 * - everything else stays together as one HTML/JS creative
 */
function blockToCreatives(block: string, width: number, height: number): string[] {
  const text = block.replace(HTML_COMMENT, "\n");
  const creatives: string[] = [];
  let htmlLines: string[] = [];
  const flushHtml = () => {
    const html = htmlLines.join("\n").trim();
    if (html) creatives.push(html);
    htmlLines = [];
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (BARE_URL.test(line)) {
      flushHtml();
      const markup = bareUrlToMarkup(line, width, height);
      if (markup) creatives.push(markup);
    } else {
      htmlLines.push(rawLine);
    }
  }
  flushHtml();
  return creatives;
}

function normalizeFile(file: string): string {
  return file.replace(/\.txt$/i, "").trim();
}

/** Look up the raw text of `ads/<file>.txt` (extension optional). */
function rawFor(file: string): string | undefined {
  const name = normalizeFile(file);
  const key = Object.keys(rawFiles).find((k) => k.endsWith(`/${name}.txt`));
  return key ? rawFiles[key] : undefined;
}

/**
 * All creatives stored in `ads/<file>.txt`, in file order.
 * Comment-only blocks and blank blocks are dropped; bare image-URL lines
 * (one per line) each become their own rotating creative sized to the
 * file's dimensions.
 */
export function getAdCreatives(file: string): string[] {
  const raw = rawFor(file);
  if (!raw) return [];
  const { width, height } = parseAdDimensions(file);
  // Strip HTML comments FIRST: instruction headers contain `---` examples
  // and must never be split (an orphaned comment tail would render as text).
  const withoutComments = raw.replace(HTML_COMMENT, "\n");
  return withoutComments
    .split(SEPARATOR)
    .flatMap((block) => blockToCreatives(block, width, height));
}

/** Does this slot have at least one real creative pasted in? */
export function hasAdCreative(file: string): boolean {
  return getAdCreatives(file).length > 0;
}

/**
 * Width/height encoded in the file name (`…-728x90…` → 728 × 90).
 * Falls back to a medium rectangle so placeholders always have a size.
 */
export function parseAdDimensions(file: string): { width: number; height: number } {
  const m = /(\d{2,4})\s*[x×]\s*(\d{2,4})/i.exec(normalizeFile(file));
  if (!m) return { width: 300, height: 250 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Inject raw ad markup into a host element and EXECUTE its scripts
 * (scripts created via innerHTML never run — swap each for a fresh copy).
 * Returns a cleanup that empties the host again.
 */
export function injectAdMarkup(host: HTMLElement, html: string): () => void {
  host.innerHTML = html;
  host.querySelectorAll("script").forEach((old) => {
    const script = document.createElement("script");
    for (const attr of Array.from(old.attributes)) {
      script.setAttribute(attr.name, attr.value);
    }
    script.textContent = old.textContent;
    old.replaceWith(script);
  });
  return () => {
    host.replaceChildren();
  };
}

/** Files already injected globally during this page load. */
const injectedGlobal = new Set<string>();

/**
 * Site-wide, invisible placements (popunder …): injects ONE random creative
 * into a hidden body-level host, at most once per page load per file.
 * Returns the injected html, or null.
 *
 * When `creative` is passed (AdPopunder resolved it from AdsContext — the
 * admin-managed database row), that exact creative is used; otherwise the
 * random pick comes from `ads/<file>.txt` (file fallback).
 */
export function injectGlobalAd(file: string, creative?: string): string | null {
  if (typeof document === "undefined") return null;
  const name = normalizeFile(file);
  if (injectedGlobal.has(name)) return null;
  let html: string;
  if (creative !== undefined && creative.trim()) {
    html = creative;
  } else {
    const creatives = getAdCreatives(name);
    if (creatives.length === 0) return null;
    html = creatives[Math.floor(Math.random() * creatives.length)];
  }
  injectedGlobal.add(name);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.display = "none";
  document.body.appendChild(host);
  injectAdMarkup(host, html);
  return html;
}

/**
 * Smartlink / direct-link URL from `ads/direct-link.txt` (one URL per line,
 * random pick so several offers rotate across page loads). The pick is
 * cached for the whole page load so every link on screen resolves to the
 * SAME offer instead of flapping on each render. Null when none are
 * configured.
 */
let cachedDirectLink: string | null | undefined;

export function getDirectLink(): string | null {
  if (cachedDirectLink !== undefined) return cachedDirectLink;
  const raw = rawFor("direct-link");
  let pick: string | null = null;
  if (raw) {
    const text = raw.replace(HTML_COMMENT, "\n");
    const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
    if (urls && urls.length > 0) {
      pick = urls[Math.floor(Math.random() * urls.length)];
    }
  }
  cachedDirectLink = pick;
  return pick;
}

/** Max ad cards shown per page/list (random positions). */
export const AD_CARDS_PER_PAGE = 2;

/** Session epoch — a fresh full page load reshuffles the ad positions. */
const AD_EPOCH = Date.now();

/** Small string hash (cyrb53-style) → 32-bit seed. */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 PRNG — deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute the random ad-card index set for one list (max
 * AD_CARDS_PER_PAGE = 2 positions), seeded from page-load epoch + the
 * first item's id + the length:
 *   - every card in the same grid agrees on the same positions (pure fn),
 *   - positions hold steady while the on-screen data doesn't change (no
 *     ad cards jumping around on re-renders), and
 *   - a new page load or a new result set (filters, pagination, edits)
 *     reshuffles them.
 * Cached for the last computed seed so a grid render is O(1) per card.
 */
let adSeedCache: string | null = null;
let adCardsCache: ReadonlySet<number> = new Set();

function getAdCardSet<T>(items: readonly T[]): ReadonlySet<number> {
  const len = items.length;
  if (len === 0) return new Set();
  const first = String((items[0] as { id?: unknown } | undefined)?.id ?? "");
  const seed = `${AD_EPOCH}|${first}|${len}`;
  if (seed === adSeedCache) return adCardsCache;

  const rand = mulberry32(hashSeed(seed));
  const idx = Array.from({ length: len }, (_, n) => n);
  const picked = Math.min(AD_CARDS_PER_PAGE, len);
  const chosen = new Set<number>();
  // Partial Fisher-Yates: the first `picked` slots are the sample.
  for (let i = 0; i < picked; i++) {
    const j = i + Math.floor(rand() * (len - i));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
    chosen.add(idx[i]);
  }
  adSeedCache = seed;
  adCardsCache = chosen;
  return chosen;
}

/**
 * Random in-card ad placement — grids call it per card:
 *   showAd={isAdCard(recordings, i)}
 * Replaces the old fixed every-8th pattern: each page shows at most 2 ad
 * cards, at unpredictable positions (see getAdCardSet for the seed rules).
 */
export function isAdCard<T>(items: readonly T[], index: number): boolean {
  if (items.length === 0) return false;
  return getAdCardSet(items).has(index);
}

