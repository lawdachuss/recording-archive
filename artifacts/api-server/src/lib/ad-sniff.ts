/**
 * ad-sniff.ts — auto-embed decisions for bare banner links.
 *
 * The admin pastes a LINK into a banner slot; before it is stored we probe
 * the URL once (headers only, 8s cap) so the frontend can render the right
 * creative WITHOUT anyone hand-copying <iframe> codes:
 *
 *   - serves image/*   → keep the raw link (frontend renders a sized <img>)
 *     …unless the URL has no image extension, where the frontend would box it —
 *     store an explicit sized <img> instead;
 *   - serves text/html and is FRAMEABLE → store a slot-sized <iframe> of the
 *     widget/wrapper page (this is the "automatically embed" path);
 *   - serves text/html but REFUSES framing (X-Frame-Options / CSP
 *     frame-ancestors) → a click-through smartlink-style page — store the
 *     clickable banner box, or keep the raw link when the frontend would box
 *     it anyway (no image extension);
 *   - anything else (non-OK status, other/absent content type, network
 *     failure) → store the raw link: exactly what pasting did before the
 *     sniff existed, so a flaky probe never regresses a working paste.
 *
 * Banner slots only — slotDims() returns null for popunder / direct-link,
 * which keep raw script codes / smartlinks by design.
 *
 * The generated <iframe>/<img>/box markup mirrors
 * artifacts/video-archive/src/lib/ad-creatives.ts `bareUrlToMarkup`
 * (keep the box styling in sync).
 */

const IMAGE_EXT = /\.(gif|jpe?g|png|webp|avif|bmp)(\?|#|$)/i;
const SNIFF_TIMEOUT_MS = 8_000;

export interface CreativeDecision {
  kind: "html" | "url";
  content: string;
}

export interface AdDims {
  width: number;
  height: number;
}

/** `billboard-970x250` → 970 × 250; dimension-less slots (popunder, direct-link) → null. */
export function slotDims(slot: string): AdDims | null {
  const m = /(\d{2,4})\s*[x×]\s*(\d{2,4})/i.exec(slot);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Sized <img> — matches the frontend's image branch of bareUrlToMarkup. */
function sizedImg(url: string, { width, height }: AdDims): string {
  const safe = url.replace(/"/g, "&quot;");
  return (
    `<img src="${safe}" alt="Advertisement" width="${width}" height="${height}" ` +
    `style="display:block;max-width:100%;height:auto;margin:0 auto;" />`
  );
}

/** Slot-sized embed — the networks' own iframe shape (margin attrs, frameborder, scrolling=no). */
function iframeEmbed(url: string, { width, height }: AdDims): string {
  const safe = url.replace(/"/g, "&quot;");
  return (
    `<iframe src="${safe}" width="${width}" height="${height}" ` +
    `marginwidth="0" marginheight="0" frameborder="0" scrolling="no" ` +
    `style="display:block;border:0;margin:0 auto;max-width:100%;"></iframe>`
  );
}

/** Clickable banner box — KEEP IN SYNC with bareUrlToMarkup's box branch (frontend). */
function linkBox(url: string, { height }: AdDims): string {
  const safe = url.replace(/"/g, "&quot;");
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
 * May this response be embedded in an <iframe> on another origin?
 * Missing headers → yes (widget endpoints that ship iframe codes obviously
 * want embedding); DENY/SAMEORIGIN or a frame-ancestors list that allows
 * neither `*` nor scheme-wide origins → no.
 */
export function isFrameable(headers: Headers): boolean {
  const xfo = (headers.get("x-frame-options") ?? "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;
  const csp = (headers.get("content-security-policy") ?? "").toLowerCase();
  const m = /frame-ancestors\s+([^;]+)/.exec(csp);
  if (m) {
    const list = m[1];
    if (!list.includes("*") && !list.includes("https:") && !list.includes("http:")) return false;
  }
  return true;
}

/**
 * Pure decision — what to store for a pasted bare link, given what the URL
 * returned. Non-OK statuses and absent/unknown content types fall through to
 * the raw-link behaviour.
 */
export function decideCreative(
  url: string,
  dims: AdDims,
  info: { ok: boolean; contentType: string | null; headers: Headers },
): CreativeDecision {
  if (!info.ok) return { kind: "url", content: url };
  const ct = (info.contentType ?? "").toLowerCase();
  if (ct.startsWith("image/")) {
    // The frontend boxes extension-less image URLs, so embed those explicitly.
    return IMAGE_EXT.test(url)
      ? { kind: "url", content: url }
      : { kind: "html", content: sizedImg(url, dims) };
  }
  if (ct.includes("text/html") || ct.includes("application/xhtml")) {
    if (isFrameable(info.headers)) return { kind: "html", content: iframeEmbed(url, dims) };
    // Frame-refusing page: box it — unless the frontend would box the raw
    // link anyway (no image extension), in which case keep the link raw.
    return IMAGE_EXT.test(url)
      ? { kind: "html", content: linkBox(url, dims) }
      : { kind: "url", content: url };
  }
  // Unknown/absent type → the raw pasted link (pre-sniff behaviour).
  return { kind: "url", content: url };
}

/**
 * Probe `url` once (redirect-following, headers only, 8s cap) and decide the
 * stored creative. Never throws — any failure keeps the pre-sniff behaviour
 * of storing the raw link (frontend: image extension → <img>, anything else
 * → clickable box).
 */
export async function sniffBannerUrl(url: string, dims: AdDims): Promise<CreativeDecision> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; VAULT-AdSniff/1.0)" },
      signal: AbortSignal.timeout(SNIFF_TIMEOUT_MS),
    });
    void res.body?.cancel().catch(() => {});
    return decideCreative(url, dims, {
      ok: res.ok,
      contentType: res.headers.get("content-type"),
      headers: res.headers,
    });
  } catch {
    return { kind: "url", content: url };
  }
}
