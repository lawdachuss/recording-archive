/**
 * Scoped console debug logger for the hover-preview / sprite / video flow.
 *
 * Enabled at runtime via `localStorage["debug"] = "hoverpreview,1"` or the
 * URL query `?debug=hoverpreview,1` (any value ≥1 or "1"/"true" enables full
 * logging; "2" additionally logs per-frame animation ticks). Off by default so
 * production stays clean.
 */

type DebugScope = "hoverpreview";

export function debugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ls = window.localStorage.getItem("debug") ?? "";
    const qs = new URLSearchParams(window.location.search).get("debug") ?? "";
    return `${ls},${qs}`.toLowerCase().includes("hoverpreview");
  } catch {
    return false;
  }
}

export function debugLevel(): number {
  if (!debugEnabled()) return 0;
  try {
    const raw =
      window.localStorage.getItem("debug") ??
      new URLSearchParams(window.location.search).get("debug") ??
      "";
    const m = /hoverpreview,?(\d+)/.exec(raw.toLowerCase());
    if (m) return parseInt(m[1], 10);
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Log a preview-flow event if the debug flag is on.
 * `level >= 1` (default) logs lifecycle events; `level >= 2` logs per-frame ticks.
 * The flag is re-checked on every call so it can be toggled live from the
 * console (via localStorage) without a page reload.
 */
export function dlog(scope: DebugScope, message: string, data?: unknown): void {
  if (!debugEnabled()) return;
  console.log(`%c[${scope}] ${message}`, "color:#8a6dff;font-weight:bold", data ?? "");
}

export function dtick(scope: DebugScope, message: string, data?: unknown): void {
  if (!debugEnabled() || debugLevel() < 2) return;
  console.debug(`%c[${scope}::tick] ${message}`, "color:#9aa", data ?? "");
}
