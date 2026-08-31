import { getApiBaseUrl } from "./api-base";

const PROXY_PATH = "/api/media";

// Cloudflare Worker that fetches catbox (which is unreachable from the browser,
// Vercel, and ordinary datacenter egress). It forces HTTP/1.1 + a Safari UA —
// catbox breaks over HTTP/2 and with a Chrome UA — and returns the original
// bytes (content-type preserved, no re-encode/flatten). Serves with ACAO:* and
// caches at the Cloudflare edge + browser.
const CATBOX_PROXY_ORIGIN = "https://catbox-proxy.stream-bate-media-proxy.workers.dev";
const CATBOX_PROXY_PATH = "/proxy";

/**
 * Build a Cloudflare-Worker proxy URL for a catbox-hosted file. Returns the
 * original URL unchanged for non-catbox hosts so the caller can use this as a
 * drop-in replacement.
 */
export function catboxProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const hostname = parsed.hostname;
  const isCatbox = hostname === "catbox.moe" || hostname.endsWith(".catbox.moe");
  if (!isCatbox) return url;
  return `${CATBOX_PROXY_ORIGIN}${CATBOX_PROXY_PATH}?url=${encodeURIComponent(url)}`;
}

/**
 * Hosts whose media must NOT go through the server proxy. catbox blocks
 * connections from datacenter/server IPs and kills any request carrying a
 * third-party Referer, so proxying it always fails (502). Loading it directly
 * in the browser (with referrerPolicy="no-referrer" on the media element) is
 * the only way its previews can load.
 */
const NO_PROXY_HOSTS: string[] = [
  // iili.io / freeimage.host: blocks datacenter/server IPs, returns 502 when
  // proxied through the API server. Must load directly from the browser with
  // referrerPolicy="no-referrer" on the media element.
  "iili.io",
  "freeimage.host",
  // (kept for forward-compat) pixhost used to load directly, but a page-full
  // of thumbnails + sprites opened dozens of parallel connections to its CDN
  // and it rate-limited (429 / HTTP2 protocol errors). It now goes through
  // /api/media instead.
];

function isNoProxyHost(hostname: string): boolean {
  return NO_PROXY_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

const WSRV_HOSTS = [
  "catbox.moe",
  "files.catbox.moe",
  "litter.catbox.moe",
  "files.litterbox.catbox.moe",
];
// wsrv.nl can re-encode catbox (halving the byte size) at the source's native width,
// but its RESIZE pipeline 404s on catbox (libvips-specific), so we never request
// a smaller width here. The browser displays the thumbnail at CSS size regardless.
// Sprite sheets keep aspect.
const WSRV_BASE = "https://wsrv.nl/?url=";
// Fixed pass-through width. wsrv can re-encode at w=1200 (harvests bytes from
// the native width), but its RESIZE pipeline 404s on catbox. So we fix w=1200
// (pass-through / re-encode) and fall back to the no-&w form when 404'd.
const WSRV_PARAMS = "&w=1200";

function isWsrvHost(hostname: string): boolean {
  return WSRV_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

/**
 * Pure pass-through form of a wsrv.nl URL (drops the &w= resize param),
 // useful as a fallback when the &w= form 404s (wsrv's resize pipeline is
 // per-file inconsistent — some catbox files only load without &w).
 */
function altWsrvUrl(url: string): string {
  return url.replace(/&w=\d+/, "");
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

  // catbox/litterbox: route through wsrv.nl (HTTP/1.1 fetch of catbox under
  // the hood) to avoid their broken HTTP/2 connection resets in browsers.
  if (isWsrvHost(parsed.hostname)) {
    return `${WSRV_BASE}${encodeURIComponent(url)}${WSRV_PARAMS}`;
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

/**
 * Returns an alternate wsrv URL without the &w= resize param, for use when
 * the primary &w= form 404s (wsrv's resize pipeline is per-file inconsistent).
 */
export function getAlternateWsrvUrl(url: string): string {
  return altWsrvUrl(url);
}

/**
 * Proxy URL for SPRITE SHEETS.
 *
 * Sprites are divided into a grid of frames; each frame is shown by shifting
 * a background-position sized at `cols*100% × rows*100%`. Detecting that grid
 * relies on the sprite's NATIVE pixel dimensions (see SpriteSlideshow's
 * detectLayout). catbox sprites are routed through wsrv.nl to dodge catbox's
 * broken HTTP/2, but MUST keep their native size — adding &w= resizes the sheet
 * and breaks grid detection, causing all frames to show together / misaligned.
 * For catbox we therefore pass through wsrv WITHOUT the resize param. All other
 * hosts fall back to the regular proxyUrl (which preserves dimensions anyway).
 */
export function proxySpriteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (isWsrvHost(parsed.hostname)) {
    // Pass the sheet through wsrv untouched (no &w=) so native dims survive.
    return `${WSRV_BASE}${encodeURIComponent(url)}`;
  }
  return proxyUrl(url);
}