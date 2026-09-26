import { getApiBaseUrl } from "./api-base";
import { getAdaptiveImageWidth } from "./connection";
import { getSpriteGrid } from "./sprite-grid";

const PROXY_PATH = "/api/media";

/**
 * Proxy URL for catbox-hosted animated webp images. Catbox loads directly
 * from the browser now — the server proxy 502s it (catbox blocks datacenter
 * IPs) and wsrv.nl flattens animated webp — so this returns the original URL
 * unchanged. Kept for API compatibility.
 */
export function catboxProxyUrl(url: string | null | undefined): string | null {
  return url ?? null;
}

/**
 * Hosts whose media must NOT go through the server proxy. catbox blocks
 * connections from datacenter/server IPs and kills any request carrying a
 * third-party Referer, so proxying it always fails (502). Loading it directly
 * in the browser (with referrerPolicy="no-referrer" on the media element) is
 * the only way its previews can load.
 */
const NO_PROXY_HOSTS: string[] = [
  // catbox.moe + subdomains: the server proxy can't reach catbox (returns
  // 502) and the Cloudflare Worker is broken (returns 405). Loading directly
  // from the browser with referrerPolicy="no-referrer" works (200), but is
  // throttled to ~16KB/s — so static raster (thumbs, sprites) rides wsrv.nl's
  // edge CDN instead (see wsrvResizeUrl / wsrvPassthroughUrl below), and only
  // animated webp previews load direct. HTTP/2 connection resets occur under
  // high concurrency — mitigated by the per-host concurrency limiter.
  "catbox.moe",
  "litter.catbox.moe",
  // files.catbox.moe (CDN) also hits HTTP/2 reset issues under load.
  "files.catbox.moe",
  // iili.io / freeimage.host: old URLs are expired (403 hotlink placeholder),
  // new URLs work through the server proxy but aren't worth the 502 noise.
  // Loading directly avoids the server proxy 502 for expired URLs.
  "iili.io",
  "freeimage.host",
  // NOTE: imgchest.com was removed from this list on 2026-09-26. The old note
  // claimed it "returns 403 when loaded directly" — re-probed against
  // production and that is no longer true: cdn.imgchest.com answers 200 to a
  // direct fetch AND 200 through /api/media. Proxied is strictly better
  // (webp + resize + Cloudflare edge cache), so keeping it here was forfeiting
  // all three for no reason. Measured on files/e4287d56269e.jpg:
  //   direct          200 image/jpeg  76,691B  1,944ms
  //   /api/media      200 image/webp  27,230B    483ms
];

function isNoProxyHost(hostname: string): boolean {
  return NO_PROXY_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/**
 * Edge-resize proxy for hosts our own server can't reach but an external
 * resizer can. See WSRV_HOSTS below for why that list is currently empty.
 */
const WSRV_BASE = "https://wsrv.nl/";
/**
 * Hosts whose static raster media we route through wsrv.nl's edge, because our
 * own server proxy cannot reach them (catbox blocks datacenter IPs -> the
 * function hangs until it times out and Cloudflare returns a 502).
 *
 * INTENTIONALLY EMPTY. Keep it that way until catbox's DNS answers wsrv
 * *reproducibly*.
 *
 * History, because this has now been tried twice and reverted twice:
 *
 *  - 2026-09-25: probe found wsrv could not resolve files.catbox.moe at all
 *    (100% 404). Left empty. Correct.
 *  - 2026-09-26: re-probed, saw 13/14 thumbs return 200 with valid image magic,
 *    and re-enabled catbox here. WRONG. That single probe was a false positive:
 *    wsrv's resolution of catbox is intermittent, not recovered. Hours later the
 *    console showed mass 404s, and re-testing the *same* five URLs that had
 *    just returned 200 gave 0/5. wsrv's own error body is the tell:
 *        {"status":"error","code":404,
 *         "message":"The hostname of the origin is unresolvable (DNS)"}
 *    i.e. wsrv's upstream resolvers intermittently fail for this domain, and
 *    the failure surfaces as a 404 rather than a 5xx so it is indistinguishable
 *    from a dead file at the call site.
 *  - Ruled out along the way: it is NOT Referer/hotlink protection. Four header
 *    sets (none / Referer / Referer+Origin / full Sec-Fetch-*) all 404
 *    identically, and all 200 during the earlier lucky window. It is NOT
 *    ORB-blocked HTML either - the error body is 90 bytes of application/json.
 *    The origin is fine throughout: files.catbox.moe answers 200 image/jpeg
 *    directly for the same URLs.
 *
 * Consequence of leaving it empty: catbox raster loads direct, unresized, so it
 * costs more bandwidth than it should. That is the deliberate trade - a correct
 * 200 image at full size beats a 404 that also burns a wasted round trip before
 * OptimizedImage's directSrc fallback. The bandwidth is now largely recovered a
 * different way: /api/recordings serves the populated preview_images mirrors, so
 * any catbox image that 404s or stalls has real alternates to fall back to.
 *
 * Do NOT add pixhost here: wsrv answers 400 for img2/img3.pixhost.to. Pixhost
 * is reachable from the server proxy, so it already gets resize + webp + our
 * own Cloudflare edge cache via /api/media, which is strictly better.
 */
const WSRV_HOSTS: string[] = [];

const STATIC_RASTER_RE = /\.(jpe?g|png)$/i;

// No-op stubs kept for API compatibility — circuit breaker has been removed.
// wsrv.nl 404s are expected for slow/delayed catbox images; the <img> onError
// fallback to the direct catbox URL handles them. Nothing should be blocked.
export function markWsrvFailedForHost(_hostOrUrl: string): void { /* no-op */ }
export function isWsrvFailedForHost(_hostOrUrl: string): boolean { return false; }

/**
 * Extract the original upstream URL from a wsrv.nl / images.weserv.nl proxy URL.
 * Supports both modern wsrv.nl and legacy images.weserv.nl.
 */
export function extractOriginalFromWsrv(proxiedUrl: string | null | undefined): string | null {
  if (!proxiedUrl) return null;
  try {
    const parsed = new URL(proxiedUrl);
    if (!parsed.hostname.endsWith("wsrv.nl") && !parsed.hostname.endsWith("weserv.nl")) return null;
    const inner = parsed.searchParams.get("url");
    return inner || null;
  } catch {
    return null;
  }
}

/** True when `hostname` belongs to a host we route static raster images
 *  through wsrv.nl (catbox family — unreachable from our server proxy). */
function isWsrvRasterHost(hostname: string): boolean {
  if (isWsrvFailedForHost(hostname)) return false;
  return WSRV_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/**
 * True when `hostname` belongs to a host that exhibits HTTP/2 connection reset
 * issues (ERR_HTTP2_PROTOCOL_ERROR) under concurrent load and should use reduced
 * parallelism + longer timeouts.
 */
const HTTP2_RESET_HOSTS = new Set([
  "catbox.moe",
  "files.catbox.moe",
  "litter.catbox.moe",
]);

export function isHttp2ResetHost(hostname: string): boolean {
  const normalized = hostname.replace(/^www\./, "").toLowerCase();
  return HTTP2_RESET_HOSTS.has(normalized);
}

/**
 * Full-size wsrv.nl passthrough for catbox-family static raster media. wsrv
 * pulls the upstream from its own edge and re-serves it from a shared
 * Cloudflare CDN — a few seconds cold, then ~90-110ms globally-warm — instead
 * of a throttled ~16KB/s direct catbox download. Unlike wsrvResizeUrl this
 * omits every transform param, so the intrinsic dimensions are preserved —
 * REQUIRED for sprite sheets, whose frame grid is auto-detected from
 * naturalWidth/Height. Animated webp is excluded (wsrv would flatten it).
 */
function wsrvPassthroughUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!isWsrvRasterHost(parsed.hostname)) return null;
    if (!STATIC_RASTER_RE.test(parsed.pathname)) return null;
    return `${WSRV_BASE}?url=${encodeURIComponent(url)}`;
  } catch {
    return null;
  }
}

/**
 * Returns a wsrv.nl resize URL when `url` is a static raster image hosted on a
 * host wsrv can reach (catbox) that our server proxy can't. Returns null
 * otherwise, so non-raster / animated / sprite URLs keep their direct path.
 */
function wsrvResizeUrl(url: string, width: number, format: "webp"): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!isWsrvRasterHost(parsed.hostname)) return null;
    // Only single-frame raster — never animated webp / .mp4_preview / gif.
    if (!STATIC_RASTER_RE.test(parsed.pathname)) return null;
    const params = new URLSearchParams({
      url,
      w: String(width),
      output: format,
    });
    return `${WSRV_BASE}?${params.toString()}`;
  } catch {
    return null;
  }
}

/**
 * Returns the hostname of the API server. When VITE_API_URL is set we compare
 * against that origin; otherwise the API is same-origin, so we compare against
 * the current page host.
 */
function getApiHostname(): string | null {
  const base = getApiBaseUrl();
  if (base) {
    try {
      return new URL(base).hostname;
    } catch {
      return null;
    }
  }
  if (typeof window !== "undefined") {
    return window.location.hostname;
  }
  return null;
}

/**
 * True when the URL already points at the media proxy (keeps proxyUrl idempotent).
 */
function isAlreadyProxied(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith(PROXY_PATH);
  } catch {
    return url.startsWith(PROXY_PATH);
  }
}

/**
 * Given a URL, return a proxy URL that fetches the resource through the API
 * server (`/api/media?url=...`). Every http(s) image / preview is routed
 * through the proxy so the browser never connects to the upstream host directly.
 *
 * Non-http(s) schemes, relative URLs, and URLs that already live on our own
 * API origin are returned unchanged to avoid proxy loops. When VITE_API_URL is
 * configured, the proxy URL includes the full API origin so that media loads
 * correctly even when the frontend and API are on different domains.
 */
export function proxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Relative or malformed URL — load it directly.
    return url;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return url;
  }

  // Some hosts refuse proxied/server fetches entirely — load them directly.
  if (isNoProxyHost(parsed.hostname)) return url;

  // Don't proxy our own API — would create an infinite loop.
  const apiHost = getApiHostname();
  if (apiHost && parsed.hostname === apiHost) return url;
  if (isAlreadyProxied(url)) return url;

  const base = getApiBaseUrl();
  const path = `${PROXY_PATH}?url=${encodeURIComponent(url)}`;
  return base ? `${base}${path}` : path;
}

export interface ProxyImageOptions {
  /** Target width in px. Defaults to the live adaptive tier (400/800/1200). */
  width?: number;
  /** Convert to a modern format server-side. Defaults to webp. */
  format?: "webp";
}

/**
 * Proxy URL for raster image thumbnails, with server-side resize + format
 * conversion appended (`&w=` / `&fmt=`). The media proxy compresses the source
 * to the requested width (and converts to webp), so a grid card downloads tens
 * of KB instead of a full-resolution JPEG — the single biggest factor in
 * first-paint time on a slow connection.
 *
 * Width is full quality (1200px) unless the user enabled Data Saver (400px).
 * Hosts the server proxy can't reach (NO_PROXY_HOSTS, e.g. catbox)
 * route their static raster thumbnails through wsrv.nl's edge instead — still
 * resized + webp, plus a shared global CDN cache for repeat hits.
 */
export function proxyImageUrl(
  url: string | null | undefined,
  options?: ProxyImageOptions,
): string | null {
  if (!url) return null;

  // If the URL is ALREADY routed through the media proxy (e.g. the caller did
  // proxyUrl() first), extract the original upstream URL so we can rebuild the
  // proxy URL with width/format params appended — keeping it idempotent.
  let upstream = url;
  try {
    // Resolve against the API base so a RELATIVE proxy url ("/api/media?url=…",
    // what proxyImageUrl returns when no VITE_API_URL is set) parses instead of
    // throwing — without this the function was not idempotent and returned null.
    const parsed = new URL(url, getApiBaseUrl() || "http://relative.invalid");
    if (parsed.pathname.startsWith(PROXY_PATH)) {
      const inner = parsed.searchParams.get("url");
      if (inner) upstream = inner;
    }
  } catch {
    return null;
  }

  const base = proxyUrl(upstream);
  if (!base) return null;
  // Direct loads (NO_PROXY_HOSTS / relative / our own API) can't be resized by
  // the server proxy. But catbox-family static raster thumbnails CAN be resized
  // + webp-converted through wsrv.nl's edge (which reaches catbox where our
  // server proxy 502s), giving a resize win plus a shared global edge cache.
  const width = options?.width ?? getAdaptiveImageWidth();
  const format = options?.format ?? "webp";
  if (base === upstream) {
    const wsrv = wsrvResizeUrl(upstream, width, format);
    if (wsrv) return wsrv;
    // Not resizable through wsrv (animated/mixed content or non-wsrv host that
    // must load direct) — return the direct URL unchanged.
    return base;
  }

  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}w=${width}&fmt=${format}`;
}



/**
 * Sprite sheet request width (px). Sheets are served through the media proxy
 * with a resize + webp conversion, which is a ~70% byte saving (measured:
 * 314 KB full-res JPEG → 92 KB webp) because sheets are inherently huge — a
 * 4×4 grid of 16:9 frames is 2560×1440 or larger.
 *
 * 1920 keeps each frame at 480×270, comfortably above the ~300px card width,
 * and 1920×1080 is an entry in SpriteSlideshow's KNOWN_LAYOUTS, so grid
 * detection still resolves for any host that relies on auto-detection. The
 * media proxy's `withoutEnlargement` means smaller sheets (1280×720,
 * 1600×900) pass through untouched and keep their own known layouts.
 */
const SPRITE_WIDTH = 1920;

/**
 * Proxy URL for SPRITE SHEETS.
 *  - pixhost (and other proxied hosts): same-origin /api/media proxy, resized
 *    to SPRITE_WIDTH + webp.
 *  - catbox family: full-size wsrv.nl passthrough — catbox is unproxiable
 *    (502) and throttles direct downloads, so its sheets keep native
 *    dimensions. wsrv sends ACAO:* so preloads can still persist them to IDB.
 *
 * Native dimensions are no longer required for grid detection: getSpriteGrid()
 * already returns a static 4×4 for pixhost.to (which serves every reachable
 * sheet), and SpriteSlideshow skips detectLayout() entirely when explicit
 * cols/rows are supplied.
 */
export function proxySpriteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const wsrv = wsrvPassthroughUrl(url);
  if (wsrv) return wsrv;
  const base = proxyUrl(url);
  if (!base) return null;
  // Direct loads (NO_PROXY_HOSTS / relative / our own API) go to the upstream
  // untouched — don't bolt transform params onto a URL the proxy never sees.
  if (base === url) return base;
  // Only force a width when the grid is statically known. SpriteSlideshow
  // otherwise infers the grid from the loaded image's intrinsic size, so a
  // forced width would make every sheet look 4x4 and garble any real grid that
  // isn't. This is the same invariant enforced by sprite-transform.test.ts, but
  // enforced here too so a new host can't reach production without a
  // getSpriteGrid() entry.
  if (!getSpriteGrid(url)) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}w=${SPRITE_WIDTH}&fmt=webp`;
}
