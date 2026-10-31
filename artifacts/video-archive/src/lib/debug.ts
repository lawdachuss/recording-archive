/**
 * Scoped console debug logger for the hover-preview / sprite / video flow.
 *
 * Enabled at runtime via `localStorage["debug"] = "hoverpreview,1"` or the
 * URL query `?debug=hoverpreview,1` (any value ≥1 or "1"/"true" enables full
 * logging; "2" additionally logs per-frame animation ticks). Off by default so
 * production stays clean.
 */

type DebugScope = "hoverpreview";

let cachedEnabled: boolean | null = null;
let cachedLevel: number = 0;

function updateDebugCache(): void {
  if (typeof window === "undefined") {
    cachedEnabled = false;
    cachedLevel = 0;
    return;
  }
  try {
    const ls = window.localStorage.getItem("debug") ?? "";
    const qs = new URLSearchParams(window.location.search).get("debug") ?? "";
    const raw = `${ls},${qs}`.toLowerCase();
    cachedEnabled = raw.includes("hoverpreview");
    if (cachedEnabled) {
      const m = /hoverpreview,?(\d+)/.exec(raw);
      cachedLevel = m ? parseInt(m[1], 10) : 1;
    } else {
      cachedLevel = 0;
    }
  } catch {
    cachedEnabled = false;
    cachedLevel = 0;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", updateDebugCache);
}

export function debugEnabled(): boolean {
  if (cachedEnabled === null) {
    updateDebugCache();
  }
  return cachedEnabled ?? false;
}

export function debugLevel(): number {
  if (cachedEnabled === null) {
    updateDebugCache();
  }
  return cachedLevel;
}

/** Force refresh of cached debug state (useful if set via console in same tab). */
export function refreshDebugState(): void {
  updateDebugCache();
}

/**
 * Log a preview-flow event if the debug flag is on.
 * `level >= 1` (default) logs lifecycle events; `level >= 2` logs per-frame ticks.
 */
export function dlog(scope: DebugScope, message: string, data?: unknown): void {
  if (!debugEnabled()) return;
  console.log(`%c[${scope}] ${message}`, "color:#8a6dff;font-weight:bold", data ?? "");
}

export function dtick(scope: DebugScope, message: string, data?: unknown): void {
  if (!debugEnabled() || debugLevel() < 2) return;
  console.debug(`%c[${scope}::tick] ${message}`, "color:#9aa", data ?? "");
}
