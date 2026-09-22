import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import { getApiBaseUrl } from "./lib/api-base";
import App from "./App";
import { initRum } from "./lib/rum";
import "./index.css";

// Real-user monitoring: Core Web Vitals + resource timing, 10% sampled,
// beaconed fire-and-forget. Must never affect the page (see lib/rum.ts).
initRum();

const baseUrl = getApiBaseUrl();
if (baseUrl) {
  setBaseUrl(baseUrl);
}

// Safety net: never let a stray unhandled promise rejection from IDB caching,
// the Supabase lazy load, or network preloads spam the console / trip the
// devtools breakpoint. These are all best-effort fetch-dedup layers.
window.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
});

// Auto-recover when a user has an older version open during a new deployment.
// If a hashed chunk can't be found on the server, reload the page to load the latest HTML.
function handleChunkError(reason: string) {
  const reloadKey = "app_stale_chunk_reload";
  const lastReload = sessionStorage.getItem(reloadKey);
  const now = Date.now();
  if (!lastReload || now - Number(lastReload) > 10_000) {
    sessionStorage.setItem(reloadKey, String(now));
    console.warn(`[deploy] Stale chunk detected (${reason}), reloading latest version...`);
    window.location.reload();
  }
}

window.addEventListener("vite:preloadError", () => {
  handleChunkError("vite:preloadError");
});

window.addEventListener("error", (e) => {
  const msg = (e.message || "").toLowerCase();
  if (
    msg.includes("dynamically imported module") ||
    msg.includes("mime type of \"text/html\"") ||
    msg.includes("failed to fetch dynamically imported") ||
    msg.includes("failed to load module script")
  ) {
    handleChunkError(e.message);
  }
});

// Stable production service worker for repeat-view image caching.
// API data stays under React Query so it can honor freshness rules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
    // When an updated Service Worker takes control, force a single reload so
    // clients drop any stale hashed JS bundle and pick up the new deployment.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
