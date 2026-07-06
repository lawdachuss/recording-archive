const IMAGE_CACHE = "vault-images-v2";
const IMAGE_MAX_ENTRIES = 300;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|$)/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("vault-img-") || key === "vault-images-v1")
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
    if (response.ok) {
      cache.put(request, response.clone()).then(() => trimCache(cache));
    }
    return response;
  });

  return cached || refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!IMAGE_EXTENSIONS.test(url.pathname)) return;

  event.respondWith(staleWhileRevalidate(request));
});