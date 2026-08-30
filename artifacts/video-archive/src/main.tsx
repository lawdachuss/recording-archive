import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import { getApiBaseUrl } from "./lib/api-base";
import App from "./App";
import "./index.css";

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
