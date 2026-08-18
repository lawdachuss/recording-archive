const IMAGE_CACHE = "vault-images-v5";
// Raised to fit the whole catalog: ~2,200 sprite sheets + ~3,500 thumbnails.
// Sprites and thumbnails are cached through this SW so hover / grid paint are
// served from cache on repeat visits.
const IMAGE_MAX_ENTRIES = 8000;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|$)/i;
// Preview clips (MP4/WebM served through the media proxy) are cached the same
// way as images so repeat hovers play instantly from the service worker.
const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg|mp4|webm|mov)(\?|$)/i;
const CACHEABLE_IMAGE_TYPES = /^(image\/|video\/|application\/octet-stream$)/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("vault-img-") || key.startsWith("vault-images-v"))
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= IMAGE_MAX_ENTRIES) return;

  await Promise.all(keys.slice(0, keys.length - IMAGE_MAX_ENTRIES).map((request) => cache.delete(request)));
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  try {
    // cache: "no-cache" revalidates against the origin (cheap 304 when the
    // asset is unchanged) instead of blindly reusing the browser HTTP cache,
    // so a thumbnail/sprite that was regenerated in the DB with the same URL
    // shows up fresh without the user having to clear the cache.
    const response = await fetch(request, { cache: "no-cache" });
    try {
      // Cache only CORS-readable, OK, image/video responses. Opaque responses
      // (direct no-cors cross-origin loads like img2.pixhost.to) are left to
      // the browser HTTP cache — caching them can throw "network error" for
      // failed upstream loads, which would fail the request itself.
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && CACHEABLE_IMAGE_TYPES.test(contentType)) {
        cache.put(request, response.clone()).catch(() => {
          /* cache writes are best-effort — never fail the request */
        });
      }
    } catch {
      /* ignore cache errors */
    }
    return response;
  } catch (err) {
    // Network failed — fall back to a cached copy if we have one.
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  // Cache images everywhere and preview clips that go through the media proxy.
  // Full-length player videos (large files, Range requests) stay untouched.
  const isMediaRequest =
    request.destination === "image" ||
    IMAGE_EXTENSIONS.test(url.pathname) ||
    (url.pathname.endsWith("/api/media") && MEDIA_EXTENSIONS.test(url.search));

  if (!isMediaRequest) return;

  event.respondWith(staleWhileRevalidate(request));
});
