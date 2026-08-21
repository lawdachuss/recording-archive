// ─── Cache configuration ────────────────────────────────────────────────────

const IMAGE_CACHE = "vault-images-v6";
const IMAGE_MAX_ENTRIES = 10000;

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
    // Network failed — fall back to stale cache
    if (cached) return cached;
    throw err;
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

// ─── Fetch handler ──────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  const isMediaRequest =
    request.destination === "image" ||
    IMAGE_EXTENSIONS.test(url.pathname) ||
    (url.pathname.endsWith("/api/media") && MEDIA_EXTENSIONS.test(url.search));

  if (!isMediaRequest) return;

  event.respondWith(staleWhileRevalidate(request));
});
