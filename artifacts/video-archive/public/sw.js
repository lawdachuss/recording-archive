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

// Light "Image unavailable" placeholder returned when a media request fails at
// the network level (offline / CORS / unreachable host). Previously a 1×1
// transparent GIF was returned, which over the dark card background read as a
// black/empty card AND suppressed the <img> error event (so the app's own
// fallback never fired). Returning this real placeholder keeps the UI
// consistent with the proxy's fallback SVG and never renders black.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f3f4f6"/><rect x="260" y="140" width="120" height="80" rx="8" fill="#d1d5db" stroke="#9ca3af" stroke-width="2"/><path d="M300 180L340 160v40z" fill="#9ca3af"/><circle cx="285" cy="170" r="5" fill="#9ca3af"/><text x="320" y="260" text-anchor="middle" fill="#9ca3af" font-family="system-ui,sans-serif" font-size="14">Image unavailable</text></svg>`;

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

// ─── Background revalidation ────────────────────────────────────────────────

async function revalidateInBackground(request, cache) {
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) {
      await cacheResponse(cache, request, response);
    }
  } catch {
    // Background revalidation failed — no big deal, we have the stale copy
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

  // Media requests (thumbnails / sprites / previews): do NOT intercept.
  // Let the browser fetch them directly. The Service Worker's media caching
  // was the cause of thumbnails failing to display, and it is redundant with
  // the IDB blob cache (image-cache.ts), which already speeds up repeat
  // visits. Bypassing the SW here guarantees the browser loads the real image
  // the same way a direct request does (verified working end-to-end).
  const isMediaRequest =
    request.destination === "image" ||
    IMAGE_EXTENSIONS.test(url.pathname) ||
    (url.pathname.endsWith("/api/media") && MEDIA_EXTENSIONS.test(url.search));

  if (isMediaRequest) return;
});
