// ─── Cache configuration ────────────────────────────────────────────────────
// v9: removed dead staleWhileRevalidate handler (mediaCacheFirst covers it)

const IMAGE_CACHE = "vault-images-v7";
const API_CACHE = "vault-api-v2";
const IMAGE_MAX_ENTRIES = 10000;
const API_TTL = 5 * 60_000; // 5 minutes — API data changes more often than images

// Tiered TTLs — different asset types have different staleness tolerances.
// These deliberately match the origin's own contract: /api/media responds with
// `Cache-Control: public, max-age=86400, immutable` because the filenames are
// content-addressed per recording and never change. The old 30-minute
// THUMBNAIL TTL meant every thumbnail revalidated against the origin twice an
// hour, and since Cloudflare serves /api/media as DYNAMIC each revalidation was
// a full round trip to the (US-East) function — pure added origin load for
// bytes that cannot have changed. Previews stay short because they ARE
// re-generated when a recording is re-encoded.
const TTL = {
  THUMBNAIL: 24 * 60 * 60_000, // 24 hours — matches origin `immutable`
  SPRITE: 24 * 60 * 60_000,    // 24 hours — sprite sheets (immutable per URL)
  PREVIEW: 60 * 60_000,        // 1 hour — preview clips (can be re-generated)
  DEFAULT: 24 * 60 * 60_000,   // 24 hours fallback
};

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|$)/i;
const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg|mp4|webm|mov)(\?|$)/i;
const CACHEABLE_TYPES = /^(image\/|video\/|application\/octet-stream)/i;

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
          .filter((key) => {
            const isOldImageCache =
              (key.startsWith("vault-img-") || key.startsWith("vault-images-")) &&
              // Never purge the image cache this worker is currently using.
              key !== IMAGE_CACHE;
            // Previous API cache versions could contain user-specific JSON.
            // Remove them when this worker activates so the safer policy starts
            // with an empty cache instead of inheriting old entries.
            const isOldApiCache = key.startsWith("vault-api-") && key !== API_CACHE;
            return isOldImageCache || isOldApiCache;
          })
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
    let response;
    try {
      response = await fetch(request, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) {
      // Do NOT await the cache write. cache.put() consumes the whole body, so
      // awaiting it here would withhold the response until the entire file is
      // downloaded AND stored — the page's streamed progress (sprite / webp
      // preview bytes in useProgressiveImage) would only ever jump 0 → 100 in
      // one flash instead of ticking in real time. cacheResponse() reads a
      // cloned (teed) body, so writing the cache in the background never
      // consumes the response being returned to the page.
      cacheResponse(cache, request, response).catch(() => {});
    }
    return response;
  } catch (err) {
    // Timed out / offline / unreachable — fall back to a cached copy if we
    // have one (guaranteed to be a real image), else the placeholder.
    if (cached) return cached;
    // Preserve the failed-request signal so <img onError> can advance to
    // a mirror / direct source instead of treating a placeholder as success.
    return new Response("Media temporarily unavailable", {
      status: 504,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    });
  }
}

// ─── Background revalidation ────────────────────────────────────────────────

async function revalidateInBackground(request, cache) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(request, {
        cache: "no-cache",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
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
    // A missing Content-Length is normal for chunked/streamed responses.
    // Reject only an explicitly empty response; treating a missing header as
    // zero silently disabled SW caching for otherwise valid images.
    if (response.headers.get("content-length") === "0") return;

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
    const cacheControl = response.headers.get("cache-control") || "";
    const vary = response.headers.get("vary") || "";
    const requiresRevalidation =
      /\b(?:private|no-store|no-cache|must-revalidate)\b/i.test(cacheControl) ||
      /(?:^|,)\s*max-age\s*=\s*0(?:,|$)/i.test(cacheControl);
    const isCacheable = !requiresRevalidation && vary.trim() !== "*";

    if (response.ok && isCacheable) {
      // Clone and cache only responses that explicitly permit shared caching.
      const tagged = new Response(response.clone().body, {
        status: response.status,
        headers: new Headers(response.headers),
      });
      tagged.headers.set("sw-cached-at", String(Date.now()));
      cache.put(request, tagged).catch(() => {});
    } else if (!isCacheable) {
      // If a response changes from public to private/no-cache, remove any
      // earlier public snapshot so a later offline request cannot revive it.
      await cache.delete(request).catch(() => {});
    }
    return response;
  } catch {
    // Offline fallback is deliberately short-lived. Never resurrect stale API
    // snapshots indefinitely, and discard legacy/untagged entries.
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = Number(cached.headers.get("sw-cached-at") || 0);
      const age = Date.now() - cachedAt;
      if (cachedAt > 0 && age >= 0 && age <= API_TTL) return cached;
      await cache.delete(request);
    }
    // Return a simple JSON error so the app can handle it gracefully.
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

  // API requests: network-first with cache fallback (for offline/slow).
  // Never cache bearer-authenticated or user/admin/personalized endpoints:
  // Cache API keys are URL-based unless the response varies on Authorization,
  // so a later session could otherwise receive another session's stale result.
  const isSensitiveApiRequest =
    request.headers.has("authorization") ||
    /^\/api\/(?:user|admin)(?:\/|$)/.test(url.pathname) ||
    url.pathname.startsWith("/api/recordings/recommendations");
  const isApiRequest =
    url.pathname.startsWith("/api/") &&
    !url.pathname.endsWith("/api/media") &&
    request.headers.get("accept")?.includes("application/json");

  if (isApiRequest && !isSensitiveApiRequest) {
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
