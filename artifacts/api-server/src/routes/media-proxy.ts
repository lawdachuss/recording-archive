import { Router } from "express";
import https from "node:https";
import http from "node:http";
import { Resolver } from "node:dns/promises";
import { Readable } from "node:stream";

// ─── Configuration ────────────────────────────────────────────────

const CONNECTION_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

// Only proxy requests to these allowed domains
const ALLOWED_HOSTS = [
  "img2.pixhost.to",
  "pixhost.to",
  "www.pixhost.to",
  "files.catbox.moe",
  "catbox.moe",
  "lobfile.com",
  "www.lobfile.com",
  "i.ibb.co",
  "ibb.co",
  "pixeldrain.com",
  "www.pixeldrain.com",
  "xhfbhgklqylmfmfjtgkq.supabase.co",
  "setripupfosilpro.x02.me",
];

/**
 * Small placeholder SVG that we return as a graceful fallback when upstream
 * media cannot be fetched. The browser renders this as a valid image so no
 * 502 error is logged to the console. The SVG uses currentColor so it
 * adapts to the document theme.
 */
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="%23f3f4f6"/>
  <rect x="260" y="140" width="120" height="80" rx="8" fill="%23d1d5db" stroke="%239ca3af" stroke-width="2"/>
  <path d="M300 180L340 160v40z" fill="%239ca3af"/>
  <circle cx="285" cy="170" r="5" fill="%239ca3af"/>
  <text x="320" y="260" text-anchor="middle" fill="%239ca3af" font-family="system-ui,sans-serif" font-size="14">Image unavailable</text>
</svg>`;

const FALLBACK_SVG_BUFFER = Buffer.from(FALLBACK_SVG);

// ─── Failure cache ────────────────────────────────────────────────
// Cache upstream failures per URL so we don't hammer unreachable hosts
// on every page load. TTL is 10 minutes.
const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;
const FAILURE_CACHE_MAX_SIZE = 500;
const failureCache = new Map<string, number>();

function isCachedFailure(url: string): boolean {
  const cached = failureCache.get(url);
  if (!cached) return false;
  if (Date.now() - cached > FAILURE_CACHE_TTL_MS) {
    failureCache.delete(url);
    return false;
  }
  return true;
}

function markCachedFailure(url: string): void {
  // Evict oldest entry if cache is full
  if (failureCache.size >= FAILURE_CACHE_MAX_SIZE) {
    const oldestKey = failureCache.keys().next().value;
    if (oldestKey !== undefined) failureCache.delete(oldestKey);
  }
  failureCache.set(url, Date.now());
}

const router = Router();

// ─── Custom DNS Resolver ──────────────────────────────────────────
// Try multiple public DNS servers as fallback when the system DNS fails
// to resolve a hostname. This helps with hosts that may be blocked by
// certain ISPs or DNS providers.

const DNS_SERVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9", "208.67.222.222"];
const customResolver = new Resolver();
customResolver.setServers(DNS_SERVERS);

/**
 * Try to resolve a hostname using the custom DNS resolver.
 * Tries IPv4 first, then falls back to IPv6.
 * Returns the IP address or null if resolution fails.
 */
async function resolveHostname(hostname: string): Promise<string | null> {
  // Try IPv4 first
  try {
    const addresses = await customResolver.resolve4(hostname);
    if (addresses?.[0]) return addresses[0];
  } catch {
    // fall through to IPv6
  }
  // Try IPv6 as fallback
  try {
    const addresses = await customResolver.resolve6(hostname);
    return addresses?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Convert a Node.js http.IncomingMessage to a web Response object.
 * This lets the existing streamResponse function work with both
 * `fetch()` responses and `https.get()` responses.
 */
function incomingToResponse(msg: http.IncomingMessage): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(msg.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const status = msg.statusCode ?? 502;
  const body = status === 204 || status === 304
    ? null
    : Readable.toWeb(msg) as ReadableStream<Uint8Array>;

  return new Response(body, {
    status,
    statusText: msg.statusMessage ?? "",
    headers,
  });
}

/**
 * Fetch a URL with optional custom DNS resolution.
 * Uses `https.get()` with a custom `lookup` when DNS is pre-resolved,
 * bypassing system DNS for that connection. Falls back to regular
 * `fetch()` when custom DNS resolution fails.
 */
async function fetchWithTimeout(
  urlStr: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const parsedUrl = new URL(urlStr);
  const protocol = parsedUrl.protocol === "https:" ? https : http;

  // Try to resolve the hostname with our custom DNS resolver first
  const resolvedIp = await resolveHostname(parsedUrl.hostname);

  if (resolvedIp) {
    // Custom DNS resolved the hostname — use https.get() with the resolved IP
    // and set Host header + servername for proper TLS SNI.
    return new Promise<Response>((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: resolvedIp,
        port: parsedUrl.port || (protocol === https ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers: {
          ...headers,
          Host: parsedUrl.hostname,
        },
        servername: parsedUrl.hostname,
        lookup: (_host: string, _opts: any, cb: (err: Error | null, ip: string, family: number) => void) => {
          cb(null, resolvedIp, 4);
        },
        timeout: timeoutMs,
      };

      const req = protocol.request(options, (res: http.IncomingMessage) => {
        resolve(incomingToResponse(res));
      });

      req.on("error", (err: Error) => {
        reject(err);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });

      req.end();
    });
  }

  // Fallback: use regular fetch() with system DNS
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(urlStr, {
      headers,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the upstream URL with retries and exponential backoff with jitter.
 * Returns the Response on success, or null if all retries were exhausted.
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  log: any,
): Promise<Response | null> {
  // Check failure cache before attempting
  if (isCachedFailure(url)) {
    log.warn({ url }, "Media proxy skipping cached failure");
    return null;
  }

  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
    const isFirst = attempt === 1;
    const timeoutMs = CONNECTION_TIMEOUT_MS * (isFirst ? 1 : 1.5);

    try {
      const response = await fetchWithTimeout(url, headers, timeoutMs);

      // Retry on 5xx — they may be transient
      if (response.status >= 500 && response.status < 600 && attempt <= MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
        log.warn({ url, status: response.status, attempt }, "Media proxy upstream 5xx, retrying");
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // For any other status (including 4xx), return immediately — retry won't help
      return response;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (attempt <= MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
        log.warn({ url, attempt, err: errorMessage }, "Media proxy fetch failed, retrying");
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  // Cache the failure so we don't retry the same URL for a while
  markCachedFailure(url);

  return null;
}

/**
 * Stream a successful Response body to the Express Response.
 */
function streamResponse(upstreamRes: Response, res: any, log: any): void {
  // Forward content-type from upstream
  const contentType = upstreamRes.headers.get("content-type");
  if (contentType) res.setHeader("Content-Type", contentType);

  // Forward range-related headers for partial content support
  const contentLength = upstreamRes.headers.get("content-length");
  if (contentLength) res.setHeader("Content-Length", contentLength);

  const contentRange = upstreamRes.headers.get("content-range");
  if (contentRange) res.setHeader("Content-Range", contentRange);

  const acceptRanges = upstreamRes.headers.get("accept-ranges");
  if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

  // Forward the correct status for partial content
  if (upstreamRes.status === 206) {
    res.status(206);
  }

  // Cache aggressively — previews/sprite sheets are immutable
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");

  // Stream the response body
  if (upstreamRes.body) {
    const reader = upstreamRes.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
      }
    };
    pump().catch((err: unknown) => {
      log.error({ err }, "Media proxy stream error");
      if (!res.headersSent) res.status(500).end();
    });
  } else {
    upstreamRes.text().then((text: string) => res.send(text));
  }
}

router.get("/media", async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) {
    res.status(400).json({ error: "Missing 'url' query parameter" });
    return;
  }

  let urlStr: string;
  try {
    urlStr = decodeURIComponent(rawUrl);
    new URL(urlStr); // validate
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const parsed = new URL(urlStr);
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(403).json({ error: "Domain not allowed" });
    return;
  }

  // Build upstream request headers — use a real browser UA to avoid being
  // blocked by CDNs / hotlinking protections.
  const upstreamHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://chuglii.in/",
  };

  const rangeHeader = req.headers["range"];
  if (rangeHeader) {
    upstreamHeaders["Range"] = rangeHeader;
  }

  try {
    const response = await fetchWithRetry(urlStr, upstreamHeaders, req.log);

    if (!response) {
      // All retries exhausted — return a placeholder SVG instead of an error
      // so the browser doesn't log a 502 to the console.
      req.log.warn({ url: urlStr }, "Media proxy returning fallback SVG — all retries exhausted");
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Fallback", "true");
      res.status(200).send(FALLBACK_SVG_BUFFER);
      return;
    }

    if (!response.ok && response.status !== 206) {
      const body = await response.text().catch(() => "");
      req.log.warn({ url: urlStr, status: response.status, body: body.slice(0, 200) }, "Media proxy upstream error, returning fallback SVG");
      markCachedFailure(urlStr);
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Fallback", "true");
      res.status(200).send(FALLBACK_SVG_BUFFER);
      return;
    }

    streamResponse(response, res, req.log);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ err, url: urlStr }, "Media proxy fetch error, returning fallback SVG");
    if (!res.headersSent) {
      markCachedFailure(urlStr);
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Fallback", "true");
      res.status(200).send(FALLBACK_SVG_BUFFER);
    }
  }
});

export default router;
