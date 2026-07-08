const IMAGE_CACHE = "vault-images-v3";
const IMAGE_MAX_ENTRIES = 500;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|$)/i;
const CACHEABLE_IMAGE_TYPES = /^(image\/|application\/octet-stream$)/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("vault-img-") || key === "vault-images-v1" || key === "vault-images-v2")
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

  const refresh = fetch(request).then((response) => {
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && CACHEABLE_IMAGE_TYPES.test(contentType)) {
      cache.put(request, response.clone()).then(() => trimCache(cache));
    }
    return response;
  });

  return cached || refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  const isImageRequest =
    request.destination === "image" ||
    IMAGE_EXTENSIONS.test(url.pathname) ||
    (url.pathname.endsWith("/api/media") && /\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|$)/i.test(url.search));

  if (!isImageRequest) return;

  event.respondWith(staleWhileRevalidate(request));
});
