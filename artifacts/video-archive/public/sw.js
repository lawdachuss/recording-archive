// ─── Cache configuration ────────────────────────────────────────────────────

const IMAGE_CACHE = "vault-images-v7";
const API_CACHE = "vault-api-v1";
const IMAGE_MAX_ENTRIES = 10000;
const API_TTL = 5 * 60_000; // 5 minutes — API data changes more often than images

// Tiered TTLs — different asset types have different staleness tolerances.
// Thumbnails change when a recording is re-encoded (rare) → long TTL.
// Sprites are immutable per URL → very long TTL.
// Preview clips may be re-generated → medium TTL.
const TTL = {
  THUMBNAIL: 30 * 60_000,    // 30 minutes — grid thumbnails
  SPRITE: 6 * 60 * 60_000,   // 6 hours — sprite sheets (immutable per URL)
  PREVIEW: 60 * 60_000,      // 1 hour — preview clips
  DEFAULT: 30 * 60_000,      // 30 minutes fallback
};

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|$)/i;
const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg|mp4|webm|mov)(\?|$)/i;
const CACHEABLE_TYPES = /^(image\/|video\/|application\/octet-stream)/i;

// Theme-aware "Image unavailable" placeholder returned when a media request
// fails at the network level (offline / CORS / unreachable host). A
// `prefers-color-scheme` media query keeps it consistent with the app's
// dark/light themes instead of being hardcoded light. Previously a 1×1
// transparent GIF was returned, which read as a black card over the dark
// background AND suppressed the <img> error event.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><style>.bg{fill:#f3f4f6}.frame{fill:#d1d5db;stroke:#9ca3af}.icon{fill:#9ca3af}.label{fill:#9ca3af}@media(prefers-color-scheme:dark){.bg{fill:#18181b}.frame{fill:#27272a;stroke:#52525b}.icon{fill:#52525b}.label{fill:#71717a}}</style><rect class="bg" width="640" height="360"/><rect class="frame" x="260" y="140" width="120" height="80" rx="8" stroke-width="2"/><path class="icon" d="M300 180L340 160v40z"/><circle class="icon" cx="285" cy="170" r="5"/><text class="label" x="320" y="260" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14">Image unavailable</text></svg>`;

// ─── TTL detection ──────────────────────────────────────────────────────────

function detectTier(url) {
  const u = url.toLowerCase();
  // Sprite sheets: contain "sprite" in the filename
  if (u.includes("sprite")) return "SPRITE";
  // Preview clips: video extensions
  if (/\.(mp4|webm|mov)(\?|$)/.test(u)) return "PREVIEW";
  // Thumbnails: image extensions (but not sprite)
  if (IMAGE_EXTENSIONS.test(u)) return "THUMBNAIL";
  return "DEFAULT";
}

function getTtlForUrl(url) {
  return TTL[detectTier(url)] ?? TTL.DEFAULT;
}

// ─── Service worker lifecycle ───────────────────────────────────────────────

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("vault-img-") || key.startsWith("vault-images-"))
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

// ─── Cache trimming ─────────────────────────────────────────────────────────

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= IMAGE_MAX_ENTRIES) return;

  // Strategy: evict oldest entries first (FIFO), but protect sprites
  // (they're immutable and most valuable for hover previews).
  const toDelete = keys.slice(0, keys.length - IMAGE_MAX_ENTRIES);
  for (const request of toDelete) {
    await cache.delete(request);
  }
}

// ─── Stale-while-revalidate with tiered TTLs ───────────────────────────────

async function staleWhileRevalidate(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  // Check freshness using tier-specific TTL
  if (cached) {
    const cachedAt = cached.headers.get("sw-cached-at");
    if (cachedAt) {
      const age = Date.now() - Number(cachedAt);
      const ttl = getTtlForUrl(request.url);
      if (age < ttl) {
        // Fresh — serve from cache without network
        return cached;
      }
      // Stale — serve from cache but revalidate in background
      revalidateInBackground(request, cache);
      return cached;
    }
  }

  // No cache or no timestamp — fetch fresh
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) {
      await cacheResponse(cache, request, response);
    }
    return response;
  } catch (err) {
    // Network failed (CORS, offline, unreachable host, etc.).
    // Prefer a stale cached copy; otherwise return the light
    // "Image unavailable" placeholder so the card never renders black.
    if (cached) return cached;
    return new Response(PLACEHOLDER_SVG, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      },
    });
  }
}

// ─── Media cache-first (thumbnails / sprites / previews) ───────────────────
//
// Cache-first for valid images, with hard guards so the "Image unavailable"
// placeholder SVG can NEVER be cached or served from cache:
//   - cacheResponse() refuses to store svg / non-image content-types.
//   - We only serve a cached entry if its content-type is image/* (not svg).
// Because catbox/pixhost image URLs are immutable per recording, a cached
// entry is always the correct bytes, so cache-first is safe and makes
// pre-warmed + repeat loads instant. The network fetch uses the default cache
// mode so the Cloudflare edge cache in front of /api/media is still honored.
async function mediaCacheFirst(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    const ct = cached.headers.get("content-type") || "";
    // Only serve the cached copy if it is a real image (never the svg
    // placeholder). We never cache opaque/cross-origin responses whose
    // content-type we can't verify, so this guard is enough.
    if (ct.startsWith("image/") && !ct.includes("svg+xml")) {
      const cachedAt = cached.headers.get("sw-cached-at");
      const fresh =
        cachedAt &&
        Date.now() - Number(cachedAt) < getTtlForUrl(request.url);
      if (fresh) return cached; // instant, no extra network traffic
      // Stale but valid — serve it now and refresh in the background.
      revalidateInBackground(request, cache);
      return cached;
    }
  }

  try {
    // Default fetch (no mode upgrade): <img> requests are no-cors and must
    // stay that way — upgrading to CORS would (a) mismatch the cache key and
    // never hit, and (b) risk a thrown TypeError. catbox is cached by the IDB
    // blob cache (image-cache.ts) which uses a readable CORS fetch; pixhost
    // (/api/media, same-origin) is cached here. A hard timeout prevents a
    // stalled upstream (catbox can hold connections open) from hanging the tab.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) {
      await cacheResponse(cache, request, response);
    }
    return response;
  } catch (err) {
    // Timed out / offline / unreachable — fall back to a cached copy if we
    // have one (guaranteed to be a real image), else the placeholder.
    if (cached) return cached;
    return new Response(PLACEHOLDER_SVG, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      },
    });
  }
}

// ─── Background revalidation ────────────────────────────────────────────────

async function revalidateInBackground(request, cache) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(request, {
      cache: "no-cache",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (response.ok) {
      await cacheResponse(cache, request, response);
    }
  } catch {
    // Background revalidation failed / timed out — no big deal, we have the
    // stale copy already served to the user.
  }
}

// ─── Cache response with metadata ───────────────────────────────────────────

async function cacheResponse(cache, request, response) {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (!CACHEABLE_TYPES.test(contentType)) return;
    // Never cache the "Image unavailable" placeholder — it would otherwise be
    // served as "fresh" for the thumbnail TTL and mask a recovered image.
    if (contentType.includes("image/svg+xml")) return;
    // Never cache empty/throttled responses (catbox can answer 200 + 0 bytes),
    // which would otherwise be served as a blank image.
    if ((response.headers.get("content-length") || "0") === "0") return;

    const taggedResponse = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
    taggedResponse.headers.set("sw-cached-at", String(Date.now()));
    taggedResponse.headers.set("sw-tier", detectTier(request.url));

    await cache.put(request, taggedResponse);
  } catch {
    /* cache writes are best-effort */
  }
}

// ─── API cache (network-first, fallback to cache on failure) ──────────────

async function networkFirstWithCache(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) {
      // Clone and cache a copy (non-blocking)
      const tagged = new Response(response.clone().body, {
        status: response.status,
        headers: new Headers(response.headers),
      });
      tagged.headers.set("sw-cached-at", String(Date.now()));
      cache.put(request, tagged).catch(() => {});
    }
    return response;
  } catch {
    // Network failed — serve from cache if available
    const cached = await cache.match(request);
    if (cached) return cached;
    // Return a simple JSON error so the app can handle it gracefully
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ─── Fetch handler ──────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("range")) return;

  const url = new URL(request.url);

  // API requests: network-first with cache fallback (for offline/slow)
  const isApiRequest =
    url.pathname.startsWith("/api/") &&
    !url.pathname.endsWith("/api/media") &&
    request.headers.get("accept")?.includes("application/json");

  if (isApiRequest) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // Media requests (thumbnails / sprites / previews).
  // IMPORTANT: only same-origin media (/api/media — i.e. pixhost proxied
  // through our server) is intercepted + cached by the SW. Cross-origin hosts
  // such as catbox/litterbox serve the bytes directly to the browser and are
  // THROTTLED when hit with many concurrent connections — if the SW also
  // re-fetched them (and applied a 15s timeout that returned a placeholder on
  // a slow response) it made the connection-reset problem far worse. So for
  // cross-origin media we do a plain pass-through and let the browser handle
  // timing/retries itself. The IDB blob cache (image-cache.ts) still caches
  // cross-origin images client-side for repeat visits.
  const isMediaRequest =
    request.destination === "image" ||
    IMAGE_EXTENSIONS.test(url.pathname) ||
    (url.pathname.endsWith("/api/media") && MEDIA_EXTENSIONS.test(url.search));

  if (isMediaRequest && url.origin === self.location.origin) {
    event.respondWith(mediaCacheFirst(request));
    return;
  }
  // Cross-origin media (catbox etc.): pass through untouched.
});
