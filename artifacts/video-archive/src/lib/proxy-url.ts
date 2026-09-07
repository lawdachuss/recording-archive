import { getApiBaseUrl } from "./api-base";
import { getAdaptiveImageWidth } from "./adaptive-quality";

const PROXY_PATH = "/api/media";

/**
 * Proxy URL for catbox-hosted animated webp images. Catbox loads directly
 * from the browser now (wsrv.nl DNS broken, server proxy 502, Worker 405),
 * so this returns the original URL unchanged. Kept for API compatibility.
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
  // catbox.moe + subdomains: wsrv.nl can't resolve catbox DNS (returns 404),
  // the server proxy can't reach catbox (returns 502), and the Cloudflare
  // Worker is broken (returns 405). Loading directly from the browser with
  // referrerPolicy="no-referrer" works (200). HTTP/2 connection resets occur
  // under high concurrency — mitigated by the per-host concurrency limiter.
  "catbox.moe",
  "litter.catbox.moe",
  // files.catbox.moe (CDN) also hits HTTP/2 reset issues under load.
  "files.catbox.moe",
  // iili.io / freeimage.host: old URLs are expired (403 hotlink placeholder),
  // new URLs work through the server proxy but aren't worth the 502 noise.
  // Loading directly avoids the server proxy 502 for expired URLs.
  "iili.io",
  "freeimage.host",
  // imgchest.com: returns 502 when proxied through /api/media (server can't
  // reach it) and 403 when loaded directly. Loading directly avoids the 502.
  "imgchest.com",
];

function isNoProxyHost(hostname: string): boolean {
  return NO_PROXY_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/**
 * Edge-resize proxy for hosts our own server can't reach but wsrv.nl CAN.
 * wsrv.nl pulls the upstream from its own edge and re-serves it from a shared
 * Cloudflare CDN — verified working for files.catbox.moe (which 502s through
 * the /api/media server proxy because catbox blocks datacenter IPs). Routing
 * catbox raster thumbnails through wsrv gives server-side resize + webp plus a
 * global edge cache (~90-110ms repeat hits instead of 8s+ cold direct loads).
 */
const WSRV_BASE = "https://images.weserv.nl/";
const WSRV_HOSTS = ["catbox.moe", "litter.catbox.moe", "files.catbox.moe"];

const STATIC_RASTER_RE = /\.(jpe?g|png)$/i;

/** True when `hostname` belongs to a host we route static raster images
 *  through wsrv.nl (catbox family — unreachable from our server proxy). */
function isWsrvRasterHost(hostname: string): boolean {
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
 * Width defaults to the live adaptive-quality tier, which is measured from how
 * long past thumbnails actually took to load on THIS connection (and honors
 * Data Saver). Hosts the server proxy can't reach (NO_PROXY_HOSTS, e.g. catbox)
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
    const parsed = new URL(url);
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
 * Proxy URL for SPRITE SHEETS. Same as proxyUrl — sprites load directly
 * from the browser (catbox in NO_PROXY_HOSTS) or through the server proxy
 * (pixhost). Native dimensions are preserved.
 */
export function proxySpriteUrl(url: string | null | undefined): string | null {
  return proxyUrl(url);
}