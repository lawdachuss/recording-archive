import { Router } from "express";
import https from "node:https";
import http from "node:http";
import { Resolver, lookup as systemLookup } from "node:dns/promises";
import net from "node:net";
import { Readable } from "node:stream";

// ─── Configuration ────────────────────────────────────────────────

const CONNECTION_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

// ─── Per-host upstream worker pool ────────────────────────────────────
// The browser may ask for a whole page of thumbnails at once; if each request
// opened its own upstream connection, hosts like pixhost would see a burst and
// rate-limit (429) or drop HTTP/2 streams. Instead every upstream fetch goes
// through a per-host gate: at most HOST_MAX_CONCURRENT in flight, with a small
// minimum gap between connection starts. Clients hit OUR origin as fast as they
// want (HTTP/2 multiplexed, cached immutable); pixhost only ever sees a smooth,
// parallel-but-bounded stream.
const HOST_MAX_CONCURRENT = 5;
const HOST_START_INTERVAL_MS = 70;

interface HostGate {
  active: number;
  lastStart: number;
  waiters: Array<() => void>;
  timer: NodeJS.Timeout | null;
}

const hostGates = new Map<string, HostGate>();

function getHostGate(host: string): HostGate {
  let gate = hostGates.get(host);
  if (!gate) {
    gate = { active: 0, lastStart: 0, waiters: [], timer: null };
    hostGates.set(host, gate);
  }
  return gate;
}

function releaseHostGate(gate: HostGate): void {
  gate.active--;
  scheduleHostGate(gate);
}

function scheduleHostGate(gate: HostGate): void {
  if (gate.timer) return;
  const tryStart = () => {
    gate.timer = null;
    if (gate.waiters.length === 0 || gate.active >= HOST_MAX_CONCURRENT) return;
    const now = Date.now();
    const wait = Math.max(0, gate.lastStart + HOST_START_INTERVAL_MS - now);
    if (wait > 0) {
      gate.timer = setTimeout(tryStart, wait);
      return;
    }
    gate.lastStart = now;
    gate.active++;
    const next = gate.waiters.shift();
    next?.();
    if (gate.waiters.length) gate.timer = setTimeout(tryStart, HOST_START_INTERVAL_MS);
  };
  gate.timer = setTimeout(tryStart, 0);
}

/** Resolve once this host has a free upstream slot. Returns a release fn. */
function acquireHostGate(host: string): Promise<() => void> {
  const gate = getHostGate(host);
  return new Promise((resolve) => {
    gate.waiters.push(() => resolve(() => releaseHostGate(gate)));
    scheduleHostGate(gate);
  });
}

// ─── Failure cache ────────────────────────────────────────────────

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

// ─── SSRF guard ──────────────────────────────────────────────────
// We proxy arbitrary hosts now, so reject any address that resolves to a
// private / loopback / link-local / reserved range. This prevents the
// deployed server from being used to reach internal network resources.

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  const inRange = (start: string, count: number): boolean => {
    const s = ipv4ToInt(start);
    return n >= s && n < s + count;
  };
  return (
    inRange("0.0.0.0", 0x01000000) || // 0.0.0.0/8 "this network"
    inRange("10.0.0.0", 0x01000000) || // 10.0.0.0/8 private
    inRange("100.64.0.0", 0x00400000) || // 100.64.0.0/10 CGNAT
    inRange("127.0.0.0", 0x01000000) || // 127.0.0.0/8 loopback
    inRange("169.254.0.0", 0x00010000) || // 169.254.0.0/16 link-local (metadata)
    inRange("172.16.0.0", 0x00100000) || // 172.16.0.0/12 private
    inRange("192.168.0.0", 0x00010000) || // 192.168.0.0/16 private
    inRange("192.0.0.0", 0x00000100) || // 192.0.0.0/24 IETF assignments
    inRange("192.0.2.0", 0x00000100) || // 192.0.2.0/24 TEST-NET-1
    inRange("198.18.0.0", 0x00020000) || // 198.18.0.0/15 benchmarking
    inRange("198.51.100.0", 0x00000100) || // 198.51.100.0/24 TEST-NET-2
    inRange("203.0.113.0", 0x00000100) || // 203.0.113.0/24 TEST-NET-3
    inRange("224.0.0.0", 0x10000000) || // 224.0.0.0/4 multicast
    inRange("240.0.0.0", 0x10000000) || // 240.0.0.0/4 reserved
    inRange("255.255.255.255", 0x00000001) // broadcast
  );
}

function ipv6ToBigInt(ip: string): bigint {
  // Normalize IPv4-mapped addresses like ::ffff:192.168.0.1 to hex groups
  if (ip.includes(".")) {
    const v4 = ip.split(":").pop() ?? "";
    const [a, b, c, d] = v4.split(".").map(Number);
    const hex = (((a << 24) + (b << 16) + (c << 8) + d) >>> 0).toString(16).padStart(8, "0");
    ip = ip.slice(0, ip.lastIndexOf(":") + 1) + hex;
  }

  let groups: string[];
  const doubleColon = ip.indexOf("::");
  if (doubleColon !== -1) {
    const left = ip.slice(0, doubleColon).split(":").filter(Boolean);
    const right = ip.slice(doubleColon + 2).split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = ip.split(":");
  }

  let result = 0n;
  for (const group of groups) {
    result = (result << 16n) + BigInt(parseInt(group || "0", 16));
  }
  return result;
}

function isPrivateIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);
  const inRange = (start: bigint, count: bigint): boolean =>
    value >= start && value < start + count;
  return (
    inRange(0n, 1n) || // ::/128 unspecified
    inRange(1n, 1n) || // ::1/128 loopback
    inRange(0xffffffffn, 0x100000000n) || // ::ffff:0:0/96 IPv4-mapped (block all)
    inRange(BigInt(0xfc00) << 96n, BigInt(0x0200) << 96n) || // fc00::/7 ULA
    inRange(BigInt(0xfe80) << 96n, BigInt(0x0400) << 96n) || // fe80::/10 link-local
    inRange(BigInt(0xff00) << 96n, BigInt(0x0100) << 96n) || // ff00::/8 multicast
    inRange(BigInt(0x2001) << 112n, BigInt(0x10000) << 96n) // 2001:db8::/32 documentation
  );
}

function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true; // not a valid IP — treat as blocked
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
 * Fetch a URL with SSRF protection.
 * Tries custom DNS + direct connect first, then falls back to system fetch
 * with system DNS lookup + IP check. This ensures maximum compatibility
 * with CDNs that do geo-IP or edge selection.
 */
async function fetchWithTimeout(
  urlStr: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const parsedUrl = new URL(urlStr);
  const protocol = parsedUrl.protocol === "https:" ? https : http;

  // ---- Attempt 1: Custom DNS resolver + direct IP connect ----
  let resolvedIp = await resolveHostname(parsedUrl.hostname);
  let family = 4;

  if (resolvedIp) {
    if (isPrivateIp(resolvedIp)) {
      throw new Error(`Blocked: private/reserved IP (${resolvedIp})`);
    }

    try {
      return await directConnect(protocol, parsedUrl, headers, resolvedIp, family, timeoutMs);
    } catch (err) {
      // Network-level failure (timeout, connection refused, TLS error, etc.)
      // Fall through to Attempt 2. HTTP errors (4xx/5xx) are not thrown here
      // because directConnect resolves the promise with the Response.
      if (!(err instanceof Error)) throw err;
      const msg = err.message.toLowerCase();
      const isNetworkErr = msg.includes("timeout") || msg.includes("econn") || msg.includes("enetunreach") || msg.includes("eai_again") || msg.includes("certificate") || msg.includes("tlsv1");
      if (!isNetworkErr) throw err;
      // fall through
    }
  }

  // ---- Attempt 2: System DNS lookup + IP check, then regular fetch ----
  try {
    const result = await systemLookup(parsedUrl.hostname);
    const systemIp = result.address;
    const systemFamily = result.family ?? 4;

    if (isPrivateIp(systemIp)) {
      throw new Error(`Blocked: private/reserved IP (${systemIp})`);
    }

    // Use fetch() with the system-resolved IP via a custom lookup.
    // We can't easily inject a custom lookup into fetch(), so we use
    // the directConnect method which gives us full control.
    return await directConnect(protocol, parsedUrl, headers, systemIp, systemFamily, timeoutMs);
  } catch {
    throw new Error("DNS resolution failed or blocked");
  }
}

/**
 * Low-level HTTP(S) request to a pre-resolved IP with Host header + SNI.
 */
function directConnect(
  protocol: typeof http | typeof https,
  parsedUrl: URL,
  headers: Record<string, string>,
  resolvedIp: string,
  family: number,
  timeoutMs: number,
): Promise<Response> {
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
      lookup: (_host: string, _opts: any, cb: (err: Error | null, ip: string, fam: number) => void) => {
        cb(null, resolvedIp, family);
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

      // catbox throttles hotlinking clients by answering 200 with an empty
      // body (Content-Length: 0). Streaming that through would render a blank
      // image / silent video, so treat it as a retryable failure instead.
      if (response.status === 200 && response.headers.get("content-length") === "0") {
        if (attempt <= MAX_RETRIES) {
          log.warn({ url, attempt }, "Media proxy upstream empty 200, retrying");
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        markCachedFailure(url);
        return null;
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

  const isPartial = upstreamRes.status === 206 || !!contentRange;

  // Forward the correct status for partial content
  if (isPartial) {
    res.status(206);
  }

  if (isPartial) {
    // Video byte-range responses: never cache at the browser or CDN edge.
    // Recordings can be re-encoded under the same URL, and immutable range
    // caching breaks seeking/playhead. The service worker still handles
    // re-use of already-downloaded video independently of these headers.
    res.setHeader("Cache-Control", "no-store");
  } else {
    // Full images: cache aggressively — previews/sprite sheets are immutable
    // per URL. max-age caches in the browser; s-maxage + stale-while-revalidate
    // make Vercel's CDN hold the response at the edge, so once a pixhost asset
    // has been fetched it is served from the nearest edge POP in ~10ms instead
    // of re-invoking this function (and re-fetching the upstream) every time.
    // This is how Chaturbate-style media sites stay fast: origin hit once,
    // edge + browser + service worker cache everything after.
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable",
    );
  }

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
  let parsedUrl: URL;
  try {
    urlStr = decodeURIComponent(rawUrl);
    parsedUrl = new URL(urlStr); // validate
    // Only proxy http(s) URLs
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      res.status(400).json({ error: "Only http(s) URLs are supported" });
      return;
    }
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  // Build upstream request headers — use a real browser UA to avoid being
  // blocked by CDNs / hotlinking protections.
  const upstreamHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // catbox (and its subdomains) reject any third-party Referer — they drop
  // the connection or answer 200 with an empty body. Omit the Referer for
  // those hosts so their previews/thumbnails actually come through.
  const NO_REFERER_HOSTS = [
    "catbox.moe",
    "files.catbox.moe",
    "litter.catbox.moe",
    "files.litterbox.catbox.moe",
  ];
  const upstreamHostname = parsedUrl.hostname;
  if (!NO_REFERER_HOSTS.some((h) => upstreamHostname === h || upstreamHostname.endsWith(`.${h}`))) {
    upstreamHeaders["Referer"] = "https://chuglii.in/";
  }

  const rangeHeader = req.headers["range"];
  if (rangeHeader) {
    upstreamHeaders["Range"] = rangeHeader;
  }

  // Video / Range requests are the player itself — don't queue them behind
  // thumbnail fetches, playback must start immediately.
  const release = rangeHeader ? null : await acquireHostGate(upstreamHostname);
  try {
    const response = await fetchWithRetry(urlStr, upstreamHeaders, req.log);

    const isVideoRequest = !!rangeHeader;

    if (!response) {
      if (isVideoRequest) {
        // For video/Range requests, don't return fallback SVG —
        // let the browser handle the error (e.g., show broken video icon).
        res.status(502).end();
        return;
      }
      // Images: return placeholder SVG so console stays clean.
      req.log.warn({ url: urlStr }, "Media proxy returning fallback SVG — all retries exhausted");
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Fallback", "true");
      res.status(200).send(FALLBACK_SVG_BUFFER);
      return;
    }

    if (!response.ok && response.status !== 206) {
      if (isVideoRequest) {
        // For video, forward the actual error status + body.
        // Browsers need proper error codes for <video> to show fallback.
        const body = await response.arrayBuffer();
        res.status(response.status);
        for (const [k, v] of response.headers.entries()) {
          if (k.toLowerCase() === "content-type") res.setHeader("Content-Type", v);
        }
        res.send(Buffer.from(body));
        return;
      }
      // Images: return placeholder SVG for any upstream error.
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
  } finally {
    release?.();
  }
});

export default router;
