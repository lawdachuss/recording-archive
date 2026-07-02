import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import { getApiBaseUrl } from "./lib/api-base";
import App from "./App";
import "./index.css";

const baseUrl = getApiBaseUrl();
if (baseUrl) {
  setBaseUrl(baseUrl);
}

// Lightweight service worker: only caches images (cache-first) and fonts.
// No API request interception — React Query handles API caching.
if ("serviceWorker" in navigator) {
  const SW_CODE = `
    const CACHE_IMG = "vault-img-v1";

    self.addEventListener("install", () => self.skipWaiting());

    self.addEventListener("activate", (e) => {
      e.waitUntil(
        caches.delete(CACHE_IMG).then(() => self.clients.claim()),
      );
    });

    self.addEventListener("fetch", (e) => {
      const url = new URL(e.request.url);

      // Images — cache-first (only for known image extensions)
      if (/\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|$)/i.test(url.pathname)) {
        e.respondWith(
          caches.open(CACHE_IMG).then(async (cache) => {
            const cached = await cache.match(e.request);
            if (cached) return cached;
            const res = await fetch(e.request);
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }),
        );
      }
    });
  `;

  navigator.serviceWorker.register(
    URL.createObjectURL(new Blob([SW_CODE], { type: "application/javascript" })),
    { scope: "/" },
  ).catch(() => {});
}

createRoot(document.getElementById("root")!).render(<App />);
