import { Router } from "express";
import https from "node:https";
import http from "node:http";
import { Resolver, lookup as systemLookup } from "node:dns/promises";
import net from "node:net";
import { Readable } from "node:stream";
import {
  getImageFromRedis,
  setImageInRedis,
  getTransformFromRedis,
  setTransformInRedis,
  getDnsFromRedis,
  setDnsInRedis,
  isFailureInRedis,
  markFailureInRedis,
} from "../lib/media-cache.js";

// Connection pooling: reuse TLS/TCP connections to upstream hosts instead of
// opening a fresh handshake for every thumbnail. Without this, a burst of
// first-screen thumbnails each paid a full TCP+TLS handshake, which slow hosts
// throttle and which dominated the ~5-7s cold first-load time.
const UPSTREAM_AGENT_HTTPS = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  keepAliveMsecs: 1000,
});
const UPSTREAM_AGENT_HTTP = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  keepAliveMsecs: 1000,
});

// ─── Configuration ────────────────────────────────────────────────

const CONNECTION_TIMEOUT_MS = 20_000;
// Images must not hang for the full connection timeout — a thumbnail that slow
// is effectively broken for UX. Fail (and fall back to the placeholder) faster
// so the per-host gate slot frees up for the next thumbnail.
const IMAGE_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_REDIRECTS = 5;

// ─── Per-request wall-clock budget ───────────────────────────────────
// The whole request — host-gate wait, DNS, and every retry — must finish before
// the origin/CDN tears a slow function down. Cloudflare in front of the Vercel
// origin reports 520/524 when the connection resets mid-flight, and Vercel caps
// invocation duration anyway: with 12–20s socket timeouts x 4 attempts + backoff
// a slow pixhost fetch could hold the connection open ~90s. These budgets keep
// every invocation short enough to complete normally, while still leaving room
// for a couple of healthy retries on a server that responds in a second or two.
const IMAGE_BUDGET_MS = 25_000;
const VIDEO_BUDGET_MS = 50_000;

// ─── Per-host upstream worker pool ────────────────────────────────────
// The browser may ask for a whole page of thumbnails at once; if each request
// opened its own upstream connection, hosts like pixhost would see a burst and
// rate-limit (429) or drop HTTP/2 streams. Instead every upstream fetch goes
// through a per-host gate: at most HOST_MAX_CONCURRENT in flight, with a small
// minimum gap between connection starts. Clients hit OUR origin as fast as they
// want (HTTP/2 multiplexed, cached immutable); pixhost only ever sees a smooth,
// parallel-but-bounded stream.
const HOST_MAX_CONCURRENT = 10;
const HOST_START_INTERVAL_MS = 20;

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

/**
 * Resolve once this host has a free upstream slot. Returns a release fn, or
 * null if no slot freed up within `timeoutMs` — a request queued behind hung
 * fetches must fail fast (and fall back) instead of burning the whole request
 * budget waiting in line.
 */
function acquireHostGate(
  host: string,
  timeoutMs: number = Number.POSITIVE_INFINITY,
): Promise<(() => void) | null> {
  const gate = getHostGate(host);
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  return new Promise((resolve) => {
    const finish = (value: (() => void) | null) => {
      if (settled) {
        // A waiter that fires after the deadline already resolved still hands
        // us a slot — release it immediately so the gate counter stays correct.
        if (value) value();
        return;
      }
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => finish(null), timeoutMs);
    }
    gate.waiters.push(() => finish(() => releaseHostGate(gate)));
    scheduleHostGate(gate);
  });
}

// ─── In-memory single-flight + success cache (images only) ──────────────────
// The grid card AND the background catalog warmer routinely request the same
// first-screen thumbnails at the same moment. Without de-duplication each opens
// its own upstream fetch and they compete for the per-host gate slots, which is
// exactly what serializes the first screen. Here concurrent requests for one
// URL share a single upstream fetch, and the result is held briefly so repeat
// views (and the warmer + card pair) are served straight from memory.
interface CachedImage {
  buffer: Buffer;
  contentType: string;
  status: number;
}

const IMAGE_MEM_CACHE_TTL_MS = 5 * 60_000;
const IMAGE_MEM_CACHE_MAX = 500;
const imageMemCache = new Map<string, CachedImage & { expires: number }>();
const imageInflight = new Map<string, Promise<CachedImage | null>>();

function cacheImageInMemory(url: string, img: CachedImage): void {
  imageMemCache.set(url, { ...img, expires: Date.now() + IMAGE_MEM_CACHE_TTL_MS });
  if (imageMemCache.size > IMAGE_MEM_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = imageMemCache.keys().next().value;
    if (oldest !== undefined) imageMemCache.delete(oldest);
  }
}

async function fetchImageOnce(
  urlStr: string,
  upstreamHeaders: Record<string, string>,
  log: any,
): Promise<CachedImage | null> {
  const deadline = Date.now() + IMAGE_BUDGET_MS;
  const release = await acquireHostGate(new URL(urlStr).hostname, deadline - Date.now());
  if (!release) {
    log?.warn?.({ url: urlStr }, "Media proxy image host gate timeout");
    return null;
  }
  try {
    const response = await fetchWithRetry(urlStr, upstreamHeaders, log, IMAGE_TIMEOUT_MS, deadline);
    if (!response || !response.ok) {
      // Transient upstream statuses (429 / 5xx that survived retries) are NOT
      // durable failures — don't mark them so the same URL can succeed shortly
      // after. Return null → the caller 404s and the frontend's mirror chain
      // tries another host. Genuine permanent 4xx still throw (durable cache).
      if (response && isTransientStatus(response.status)) return null;
      throw new Error(response ? `upstream ${response.status}` : "upstream fetch failed");
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    // Refuse anything that could render as a document at our origin, and bound
    // the buffered size so an attacker-chosen URL can't exhaust function memory.
    if (!isSafeMediaType(contentType, new URL(urlStr))) {
      throw new Error(`unsafe upstream content type: ${contentType}`);
    }
    const buffer = await readBodyBounded(response, MAX_IMAGE_BYTES);
    const img: CachedImage = { buffer, contentType, status: response.status };
    cacheImageInMemory(urlStr, img);
    // Shared tier: another instance (or this one, after a CDN miss) can now
    // serve the same thumbnail from Redis instead of re-fetching upstream.
    setImageInRedis(urlStr, img);
    return img;
  } finally {
    release();
  }
}

/**
 * Returns the buffered image (`CachedImage`) for `urlStr`, or null when the
 * upstream fetch failed or ran out of budget. Concurrent requests for the same
 * URL share one upstream fetch (single-flight); recent successes are served
 * from memory.
 */
async function getImage(
  urlStr: string,
  upstreamHeaders: Record<string, string>,
  log: any,
): Promise<CachedImage | null> {
  const cached = imageMemCache.get(urlStr);
  if (cached && cached.expires > Date.now()) {
    return cached;
  }

  // Shared tier (another instance already fetched / transformed this URL).
  // Fail-open: any Redis hiccup just falls through to a fresh upstream fetch.
  try {
    const shared = await getImageFromRedis(urlStr);
    if (shared) {
      cacheImageInMemory(urlStr, shared);
      return shared;
    }
  } catch (err) {
    log?.warn?.({ err, url: urlStr }, "Media proxy Redis image read failed");
  }

  let inflight = imageInflight.get(urlStr);
  if (!inflight) {
    inflight = fetchImageOnce(urlStr, upstreamHeaders, log).finally(() => {
      imageInflight.delete(urlStr);
    });
    imageInflight.set(urlStr, inflight);
  }
  return inflight;
}

// ─── Server-side image transform (resize / modern format) ─────────────────
// The adaptive-quality tiers (400/800/1200px) tell us how big a thumbnail the
// browser actually needs, but until now the proxy served the FULL-resolution
// upstream file regardless — on a slow connection that single full-size JPEG
// is the dominant factor in grid first-paint time. Here the response is
// optionally resized (and converted to webp, ~half the bytes again) right
// before it leaves the server. Transformed variants are cached in memory like
// the full-size images, and the response is marked immutable so the Vercel
// edge caches each `url | width | format` combination separately.

const TRANSFORM_CACHE_TTL_MS = 30 * 60_000;
const TRANSFORM_CACHE_MAX = 300;

interface TransformedImage {
  buffer: Buffer;
  contentType: string;
}

const transformMemCache = new Map<string, TransformedImage & { expires: number }>();
const transformInflight = new Map<string, Promise<TransformedImage>>();

function transformCacheKey(url: string, width: number, fmt: string | null): string {
  return `${url}|${fmt ?? ""}|${width}`;
}

function cacheTransform(key: string, img: TransformedImage): void {
  transformMemCache.set(key, { ...img, expires: Date.now() + TRANSFORM_CACHE_TTL_MS });
  if (transformMemCache.size > TRANSFORM_CACHE_MAX) {
    const oldest = transformMemCache.keys().next().value;
    if (oldest !== undefined) transformMemCache.delete(oldest);
  }
  setTransformInRedis(key, img);
}

/**
 * Resize `buffer` to `width` (never upscales) and optionally convert to webp.
 * Falls back to the original bytes on ANY failure so a transform problem can
 * never take thumbnails offline — it just serves full size as before.
 */
async function transformImage(
  buffer: Buffer,
  contentType: string,
  width: number,
  fmt: string | null,
  log: any,
): Promise<TransformedImage> {
  // Only static raster formats — never GIF (animated) or passthrough payloads.
  const isRaster = contentType.startsWith("image/") && !contentType.includes("gif");
  if (!isRaster) return { buffer, contentType };
  try {
    // sharp is a native module kept OUTSIDE the esbuild bundle. If it ever
    // isn't available on the runtime (missing platform binary, stripped
    // node_modules, ...) we degrade to passthrough instead of erroring.
    const { default: sharp } = await import("sharp");
    const pipeline = sharp(buffer, { failOn: "none" }).rotate().resize({
      width,
      withoutEnlargement: true,
    });
    if (fmt === "webp") {
      const out = await pipeline
        .webp({ quality: 78, effort: 2 })
        .toBuffer({ resolveWithObject: true });
      return { buffer: out.data, contentType: "image/webp" };
    }
    const out = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: out.data, contentType: `image/${out.info.format}` };
  } catch (err) {
    log?.warn?.({ err }, "Media proxy transform failed; serving original");
    return { buffer, contentType };
  }
}

/** Single-flight + cached server-side resize of an already-fetched image. */
async function getTransformedImage(
  urlStr: string,
  img: CachedImage,
  width: number,
  fmt: string | null,
  log: any,
): Promise<TransformedImage> {
  const key = transformCacheKey(urlStr, width, fmt);
  const cached = transformMemCache.get(key);
  if (cached && cached.expires > Date.now()) return cached;

  // Shared tier: a resized/webp variant fetched by another instance.
  try {
    const shared = await getTransformFromRedis(key);
    if (shared) {
      transformMemCache.set(key, { ...shared, expires: Date.now() + TRANSFORM_CACHE_TTL_MS });
      return shared;
    }
  } catch (err) {
    log?.warn?.({ err, key }, "Media proxy Redis transform read failed");
  }

  let inflight = transformInflight.get(key);
  if (!inflight) {
    inflight = transformImage(img.buffer, img.contentType, width, fmt, log)
      .then((result) => {
        cacheTransform(key, result);
        return result;
      })
      .finally(() => transformInflight.delete(key));
    transformInflight.set(key, inflight);
  }
  return inflight;
}

// ─── Failure cache ────────────────────────────────────────────────

/**
 * Small placeholder SVG that we return as a graceful fallback when upstream
 * media cannot be fetched. The browser renders this as a valid image so no
 * 502 error is logged to the console. The SVG uses currentColor so it
 * adapts to the document theme.
 */
// ─── Failure cache ────────────────────────────────────────────────
// Cache upstream failures per URL so we don't hammer unreachable hosts
// on every page load. TTL is 10 minutes. Backed by memory + shared Redis so a
// cold serverless instance doesn't immediately re-attack a host everyone else
// already learned is down.
const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;
const FAILURE_CACHE_MAX_SIZE = 500;
const failureCache = new Map<string, number>();

async function isCachedFailure(url: string): Promise<boolean> {
  const cached = failureCache.get(url);
  if (cached) {
    if (Date.now() - cached > FAILURE_CACHE_TTL_MS) {
      failureCache.delete(url);
    } else {
      return true;
    }
  }
  try {
    if (await isFailureInRedis(url)) {
      failureCache.set(url, Date.now());
      return true;
    }
  } catch {
    // Redis hiccup — fall through, a real fetch attempt is harmless.
  }
  return false;
}

function markCachedFailure(url: string): void {
  // Evict oldest entry if cache is full
  if (failureCache.size >= FAILURE_CACHE_MAX_SIZE) {
    const oldestKey = failureCache.keys().next().value;
    if (oldestKey !== undefined) failureCache.delete(oldestKey);
  }
  failureCache.set(url, Date.now());
  markFailureInRedis(url);
}

// ─── Media type allowlist ───────────────────────────────────────────────
// The proxy only ever feeds <img>/<video> elements, so its responses must
// never be renderable documents (HTML / SVG / JS — all script-capable) at the
// trusted chuglii.in origin. Without this, a crafted URL like
//   https://chuglii.in/api/media?url=https://attacker/x.html
// makes the deployed app serve attacker HTML same-origin, which can read the
// Supabase/API credentials out of localStorage. Whitelist media types only,
// with an extension fallback for hosts that omit Content-Type.
const SAFE_MEDIA_RE =
  /^(image\/(?!svg)[a-z0-9.+-]+|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/x-mpegurl|application\/vnd\.apple\.mpegurl|application\/mpegurl|application\/octet-stream|binary\/octet-stream)$/i;
const MEDIA_EXT_RE = /\.(jpe?g|jxl|png|webp|gif|avif|apng|mp4|webm|mov|m4v|m3u8|ogg|ogv|oga|mp3|aac|wav|opus)$/i;

function isSafeMediaType(contentType: string | null | undefined, url: URL): boolean {
  if (contentType && typeof contentType === "string") {
    const ct = contentType.split(";")[0]!.trim();
    if (ct && ct !== "*/*" && ct !== "application/stream") return SAFE_MEDIA_RE.test(ct);
  }
  return MEDIA_EXT_RE.test(url.pathname);
}

/** Whole-body (image) buffering cap — thumbnails are small; refuse huge bodies. */
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

async function readBodyBounded(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error(`upstream body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
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
const dnsCache = new Map<string, { ip: string; expires: number }>();
const DNS_CACHE_TTL_MS = 5 * 60_000;

async function resolveHostname(hostname: string): Promise<string | null> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.ip;

  // Shared tier: another instance already resolved this host through its (more
  // reliable) resolver set.
  const shared = await getDnsFromRedis(hostname).catch(() => null);
  if (shared) {
    dnsCache.set(hostname, { ip: shared, expires: Date.now() + DNS_CACHE_TTL_MS });
    return shared;
  }

  let ip: string | null = null;
  // Try IPv4 first
  try {
    const addresses = await customResolver.resolve4(hostname);
    if (addresses?.[0]) ip = addresses[0];
  } catch {
    // fall through to IPv6
  }
  // Try IPv6 as fallback
  if (!ip) {
    try {
      const addresses = await customResolver.resolve6(hostname);
      ip = addresses?.[0] ?? null;
    } catch {
      ip = null;
    }
  }

  if (ip) {
    dnsCache.set(hostname, { ip, expires: Date.now() + DNS_CACHE_TTL_MS });
    setDnsInRedis(hostname, ip);
  }
  return ip;
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
    inRange(BigInt(0xffff) << 32n, BigInt(0x100000000)) || // ::ffff:0:0/96 IPv4-mapped (block all)
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
  // Re-vetted on every hop (initial fetch AND each redirect target): only
  // http(s) is ever proxied. Redirects to other schemes (file://, gopher://,
  // …) would otherwise be handed to `http.request` with a bogus host/port.
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Protocol not allowed: ${parsedUrl.protocol}`);
  }
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
      agent: protocol === https ? UPSTREAM_AGENT_HTTPS : UPSTREAM_AGENT_HTTP,
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

/** True for statuses the upstream will likely recover from in seconds. These
 * must never be persisted to the durable failure cache — a 10-minute block
 * would serve 404s long after the host clears a rate-limit window. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 425 || (status >= 500 && status < 600);
}

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
 * Returns null when absent or unparseable so callers fall back to their own
 * backoff schedule.
 */
function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Fetch the upstream URL with retries and exponential backoff with jitter.
 * `deadlineMs` (absolute ms) caps the TOTAL time spent across all attempts,
 * including backoff sleeps — so an invocation can never hold the origin
 * connection open past the platform/CDN response window (which resets the
 * connection and surfaces as a 520). Returns the Response on success, or null
 * if all retries were exhausted or the deadline elapsed.
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  log: any,
  timeoutMs: number = CONNECTION_TIMEOUT_MS,
  deadlineMs?: number,
): Promise<Response | null> {
  // Check failure cache before attempting
  if (await isCachedFailure(url)) {
    log.warn({ url }, "Media proxy skipping cached failure");
    return null;
  }

  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
    const isFirst = attempt === 1;
    const remaining = deadlineMs === undefined ? Number.POSITIVE_INFINITY : deadlineMs - Date.now();
    if (remaining <= 0) break;
    const attemptTimeout = Math.min(timeoutMs * (isFirst ? 1 : 1.5), remaining);

    try {
      let response = await fetchWithTimeout(url, headers, attemptTimeout);

      // Follow redirects (3xx with Location header)
      let redirectCount = 0;
      while (redirectCount < MAX_REDIRECTS && response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        let redirectUrl: string;
        try {
          redirectUrl = new URL(location, url).toString();
        } catch {
          break;
        }
        // Follow with no referer for the redirect target
        const redirectHeaders = { ...headers };
        delete redirectHeaders["Referer"];
        response = await fetchWithTimeout(redirectUrl, redirectHeaders, attemptTimeout);
        redirectCount++;
      }

      // Retry on 5xx — they may be transient
      if (response.status >= 500 && response.status < 600 && attempt <= MAX_RETRIES) {
        const delay = Math.min(
          BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200,
          remaining,
        );
        log.warn({ url, status: response.status, attempt }, "Media proxy upstream 5xx, retrying");
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Honor upstream rate limits (429) — pixhost in particular throttles
      // hotlinking clients. Respect Retry-After (delta-seconds or HTTP-date)
      // when present, bounded by our own deadline so a slow-cooldown host
      // never holds the invocation past the CDN response window.
      if (response.status === 429 && attempt <= MAX_RETRIES) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        const delay = Math.min(
          retryAfterMs ?? BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200,
          remaining,
        );
        log.warn({ url, attempt, retryAfterMs }, "Media proxy upstream 429, honoring Retry-After");
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
        continue;
      }

      // catbox throttles hotlinking clients by answering 200 with an empty
      // body (Content-Length: 0). Streaming that through would render a blank
      // image / silent video, so treat it as a retryable failure instead.
      if (response.status === 200 && response.headers.get("content-length") === "0") {
        if (attempt <= MAX_RETRIES) {
          log.warn({ url, attempt }, "Media proxy upstream empty 200, retrying");
          const delay = Math.min(
            BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200,
            remaining,
          );
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
        const delay = Math.min(
          BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200,
          remaining,
        );
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
  // Our origin serves HTML — a proxied text/html or image/svg+xml response is
  // scriptable in the same origin, so a browser must not sniff the document
  // type. nosniff enforces Content-Type over any possible sniffing heuristic.
  res.setHeader("X-Content-Type-Options", "nosniff");

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

  const isVideoRequest = !!rangeHeader;

  // Optional server-side resize/format for IMAGE requests only. The frontend
  // sends the adaptive tier width (400/800/1200) so thumbnails download as a
  // few tens of KB instead of full-res; `fmt=webp` converts for ~half the
  // bytes again. Malformed values are silently ignored (passthrough) so an
  // old/stale URL can never take thumbnails offline.
  const rawWidth = isVideoRequest ? undefined : req.query.w;
  const width =
    typeof rawWidth === "string" && /^\d{2,4}$/.test(rawWidth) && !rawWidth.startsWith("0")
      ? Math.min(2000, Math.max(200, parseInt(rawWidth, 10)))
      : null;
  const rawFmt = isVideoRequest ? undefined : req.query.fmt;
  const fmt = typeof rawFmt === "string" && rawFmt === "webp" ? "webp" : null;

  // Video / Range requests are the player itself — stream straight through,
  // never gated or de-duplicated (playback must start immediately). Images go
  // through getImage(), which coalesces concurrent requests and serves recent
  // successes from the in-memory cache so the first screen paints fast. The
  // per-host upstream gate is released inside getImage().
  try {
    let response: Response | null;
    if (isVideoRequest) {
      response = await fetchWithRetry(
        urlStr,
        upstreamHeaders,
        req.log,
        CONNECTION_TIMEOUT_MS,
        Date.now() + VIDEO_BUDGET_MS,
      );
    } else {
      const img = await getImage(urlStr, upstreamHeaders, req.log);
      if (!img) {
        req.log.warn({ url: urlStr }, "Media proxy image unavailable");
        res.status(404).end();
        return;
      }
      if (width !== null || fmt !== null) {
        // Resized / converted variant — cached separately so every width and
        // format is single-flight and the edge caches each one independently.
        const variant = await getTransformedImage(urlStr, img, width ?? 2000, fmt, req.log);
        response = new Response(variant.buffer, {
          status: img.status,
          headers: {
            "Content-Type": variant.contentType,
            "Content-Length": String(variant.buffer.length),
          },
        });
      } else {
        response = new Response(img.buffer, {
          status: img.status,
          headers: {
            "Content-Type": img.contentType,
            "Content-Length": String(img.buffer.length),
          },
        });
      }
    }

    if (!response) {
      if (isVideoRequest) {
        // For video/Range requests, don't return fallback SVG —
        // let the browser handle the error (e.g., show broken video icon).
        res.status(502).end();
        return;
      }
      // Images: return 404 so the browser fires an onerror event and the
      // frontend mirror-fallback chain can try the next host. A 200+SVG would
      // render the placeholder as a valid image, bypassing fallback logic.
      req.log.warn({ url: urlStr }, "Media proxy upstream failed");
      res.status(404).end();
      return;
    }

    // Central media-type gate: whatever we got back (final redirect hop
    // included), it must be a renderable-but-not-scriptable media type. HTML,
    // SVG, JSON, JS etc. are refused — never streamed from our origin.
    if (!isSafeMediaType(response.headers.get("content-type"), parsedUrl)) {
      req.log.warn(
        { url: urlStr, contentType: response.headers.get("content-type") },
        "Media proxy refused non-media upstream content",
      );
      markCachedFailure(urlStr);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(415).end();
      return;
    }

    if (!response.ok && response.status !== 206) {
      if (isVideoRequest) {
        // Forward the upstream status (browsers use it to drive the <video>
        // fallback) but never the body or content-type — upstream error pages
        // (often text/html) must not be served from our origin either.
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.status(response.status).end();
        return;
      }
      // Images: return 404 so the frontend can try the next mirror fallback.
      const body = await response.text().catch(() => "");
      req.log.warn({ url: urlStr, status: response.status, body: body.slice(0, 200) }, "Media proxy upstream error");
      // Transient statuses (rate limits / server hiccups) must not poison the
      // durable failure cache — the upstream may recover within seconds.
      if (!isTransientStatus(response.status)) markCachedFailure(urlStr);
      res.status(404).end();
      return;
    }

    streamResponse(response, res, req.log);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    req.log.error({ err, url: urlStr }, "Media proxy fetch error");
    if (!res.headersSent) {
      markCachedFailure(urlStr);
      res.status(502).end();
    }
  } finally {
    // Per-host gate slots are released inside getImage() / fetchWithRetry paths.
  }
});

export default router;
