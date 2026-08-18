import { getApiBaseUrl } from "./api-base";

const PROXY_PATH = "/api/media";

/**
 * Hosts whose media must NOT go through the server proxy. catbox blocks
 * connections from datacenter/server IPs and kills any request carrying a
 * third-party Referer, so proxying it always fails (502). Loading it directly
 * in the browser (with referrerPolicy="no-referrer" on the media element) is
 * the only way its previews can load.
 */
const NO_PROXY_HOSTS = [
  "catbox.moe",
  "files.catbox.moe",
  "litter.catbox.moe",
  "files.litterbox.catbox.moe",
  // pixhost used to load directly, but a page-full of thumbnails + sprites
  // opened dozens of parallel connections to its CDN and it rate-limited
  // (429 / HTTP2 protocol errors). It now goes through /api/media, which
  // queues upstream pixhost fetches behind a bounded per-host worker pool
  // and returns immutable-cacheable responses.
];

function isNoProxyHost(hostname: string): boolean {
  return NO_PROXY_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
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
 * Non-http(s) schemes, relative URLs, and URLs that already live on our own API
 * origin are returned unchanged to avoid proxy loops. When VITE_API_URL is
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

  // Some hosts (catbox) refuse proxied/server fetches entirely — load them
  // directly so the browser hits the upstream host itself.
  if (isNoProxyHost(parsed.hostname)) return url;

  // Don't proxy our own API — would create an infinite loop.
  const apiHost = getApiHostname();
  if (apiHost && parsed.hostname === apiHost) return url;
  if (isAlreadyProxied(url)) return url;

  const base = getApiBaseUrl();
  const path = `${PROXY_PATH}?url=${encodeURIComponent(url)}`;
  return base ? `${base}${path}` : path;
}
