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
 * Turn a bare URL into a creative sized for the slot:
 *  - image URLs (gif/jpg/png/…) → a sized `<img>` that SELF-HEALS: if the
 *    URL actually serves HTML (widget wrappers like `…&bb=123.gif`), the
 *    image error swaps itself for a slot-sized `<iframe>` of the same URL;
 *  - ANY other http(s) URL (StripCash smartlinks, tracked links,
 *    extension-less CDN images) → a clickable banner box that fills the slot
 *    and opens the link in a new tab — so pasting a lone link into a banner
 *    slot always "takes" instead of being rejected.
 * The admin API sniffs links at save time and stores finished markup for
 * most cases (see api-server/src/lib/ad-sniff.ts); this stays the render
 * path for ads/*.txt files and raw links saved when the probe failed.
 * Returns null only for an empty input.
 */
export function bareUrlToMarkup(url: string, width: number, height: number): string | null {
  if (!url) return null;
  const safe = url.replace(/"/g, "&quot;");
  if (IMAGE_EXT.test(url)) {
    return (
      `<img src="${safe}" alt="Advertisement" width="${width}" height="${height}" ` +
      `style="display:block;max-width:100%;height:auto;margin:0 auto;" ` +
      // Self-heal: <img> errors on an HTML response → replace with an iframe
      // of the SAME URL (reuses this.src — no URL re-escaping in JS, and the
      // single-quoted JS keeps this safe inside the double-quoted attribute).
      `onerror="if(!this.dataset.fb){this.dataset.fb='1';var i=document.createElement('iframe');i.src=this.src;i.width=this.width;i.height=this.height;i.frameBorder='0';i.scrolling='no';i.style.cssText='display:block;border:0;margin:0 auto;max-width:100%';this.replaceWith(i)}" />`
    );
  }
  return (
    `<a href="${safe}" target="_blank" rel="sponsored noopener nofollow" ` +
    `style="display:flex;align-items:center;justify-content:center;width:100%;` +
    `height:${height}px;box-sizing:border-box;border:1px dashed rgba(148,163,184,.45);` +
    `border-radius:8px;background:rgba(148,163,184,.08);color:rgba(148,163,184,.95);` +
    `font:600 11px/1 system-ui,-apple-system,sans-serif;letter-spacing:.12em;` +
    `text-transform:uppercase;text-decoration:none;">Advertisement</a>`
  );
}

/**
 * True when a single line is a complete, self-contained markup fragment —
 * an `<iframe …></iframe>`, `<script src=…></script>`, `<a …>…</a>` or
 * `<img …/>` written entirely on one line. Continuation lines of a
 * multi-line code (e.g. `<a href=…>` … `</a>`) are NOT self-contained.
 * Used by the admin paste handler: several self-contained one-line codes
 * become separate rotating creatives instead of one stacked blob.
 */
export function isSelfContainedLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("<") || !t.endsWith(">")) return false;
  // <tag … />
  if (/\/>$/.test(t)) return true;
  // <tag …>…</tag> — outer tag name must match the closing one.
  return /^<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*<\/\1>$/.test(t);
}

/**
 * One `---`-separated block → zero or more creatives.
 * - HTML comments are stripped (instruction headers never render)
 * - a line that is ONLY a URL becomes its own rotating creative
 *   (image URLs → sized <img>; other URLs → clickable banner box)
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
 * Drop HTML comment blocks (template/instruction headers) — DB creatives get
 * the same treatment as ads/*.txt file creatives before injection.
 */
export const stripAdComments = (html: string): string => html.replace(HTML_COMMENT, "\n");

/**
 * Bare URL lines from `ads/preroll.txt` — the file-fallback source for the
 * pre-roll player (see lib/preroll.ts). Unlike banner-slot file creatives
 * these stay RAW: the player feeds them straight to `<video src>`, never
 * through bareUrlToMarkup's boxing.
 */
export function getPrerollFileUrls(): string[] {
  const raw = rawFor("preroll");
  if (!raw) return [];
  const text = raw.replace(HTML_COMMENT, "\n");
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => BARE_URL.test(l));
}

/**
 * Inject raw ad markup into a host element and EXECUTE its scripts
 * (scripts created via innerHTML never run — swap each for a fresh copy).
 *
 * Execution order mirrors the HTML PARSER: ad codes are typically
 * `<script src="lib.js">` immediately followed by an inline
 * `<script>lib.fn()</script>` — but a freshly inserted INLINE script runs
 * the instant it's attached, while an EXTERNAL script loads async, so a
 * naive copy would run them out of order and the inline part throws
 * "ReferenceError: lib is not defined". All scripts therefore run in one
 * sequential chain: wait for each external to finish loading (failures and
 * a 15s hang-resolve keep the chain moving, like a browser past a broken
 * script), then insert the next inline/external exactly in order.
 *
 * Returns a cleanup that stops any pending chain and empties the host.
 */
export function injectAdMarkup(host: HTMLElement, html: string): () => void {
  host.innerHTML = html;
  const inert = Array.from(host.querySelectorAll("script"));
  let cancelled = false;

  let chain: Promise<void> = Promise.resolve();
  for (const old of inert) {
    const attrs = Array.from(old.attributes);
    const isExternal = attrs.some((a) => a.name.toLowerCase() === "src");
    const text = old.textContent;
    chain = chain.then(() => {
      if (cancelled) return;
      const script = document.createElement("script");
      for (const attr of attrs) script.setAttribute(attr.name, attr.value);
      if (!isExternal) {
        script.textContent = text;
        old.replaceWith(script); // inline → executes synchronously, in order
        return;
      }
      return new Promise<void>((resolve) => {
        const done = () => {
          window.clearTimeout(timer);
          resolve();
        };
        script.addEventListener("load", done, { once: true });
        script.addEventListener("error", done, { once: true });
        const timer = window.setTimeout(done, 15_000);
        old.replaceWith(script); // starts the fetch; wait before the NEXT script
      });
    });
  }

  return () => {
    cancelled = true;
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
 * Markup for a click-activated popunder that opens `url` once per page load
 * — used for the StripCash smartlink candidate in the popunder pool.
 *
 * A plain window.open() from a load handler would be eaten by popup
 * blockers, so the open happens inside a real user gesture (first click);
 * the listener removes itself so the page never pops twice. The URL is
 * JSON-serialised with "<" escaped so a crafted link can't break out of the
 * script tag. Returns null for anything that isn't a bare http(s) URL.
 */
export function buildClickPopMarkup(url: string): string | null {
  const u = url.trim();
  if (!/^https?:\/\/\S+$/i.test(u)) return null;
  const serialized = JSON.stringify(u).replace(/</g, "\\u003c");
  return (
    "<script>(function(){var u=" +
    serialized +
    ';function p(){document.removeEventListener("click",p,true);' +
    'try{window.open(u,"_blank","noopener,noreferrer");}catch(e){}}' +
    'document.addEventListener("click",p,true);})();<\/script>'
  );
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
/** Max in-card ad cards per page — live-controlled from Admin → Ads → Placements (0 disables in-card ads entirely). */
let AD_CARDS_PER_PAGE = 2;

export function setAdCardLimit(n: number): void {
  AD_CARDS_PER_PAGE = Math.max(0, Math.min(6, Math.floor(Number(n) || 0)));
}

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
 * Random in-feed ad placement — grids insert a STANDALONE <AdGridCard />
 * next to the picked card (its own grid cell, never over a video):
 *   <Fragment key={rec.id}>
 *     <VideoCard recording={rec} … />
 *     {isAdCard(recordings, i) && <AdGridCard />}
 *   </Fragment>
 * Replaces the old fixed every-8th pattern: each page shows at most 2 ad
 * cards, at unpredictable positions (see getAdCardSet for the seed rules).
 */
export function isAdCard<T>(items: readonly T[], index: number): boolean {
  if (items.length === 0) return false;
  return getAdCardSet(items).has(index);
}

