import { getApiBaseUrl } from "./api-base";

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
  // referrerPolicy="no-referrer" works (200). The old HTTP/2 reset issue
  // is no longer observed.
  "catbox.moe",
  "litter.catbox.moe",
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

// wsrv.nl routing is currently unused — catbox moved to NO_PROXY_HOSTS
// (wsrv.nl can't resolve catbox DNS). Kept as a comment for reference.

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



/**
 * Proxy URL for SPRITE SHEETS. Same as proxyUrl — sprites load directly
 * from the browser (catbox in NO_PROXY_HOSTS) or through the server proxy
 * (pixhost). Native dimensions are preserved.
 */
export function proxySpriteUrl(url: string | null | undefined): string | null {
  return proxyUrl(url);
}