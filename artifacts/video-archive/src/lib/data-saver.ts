/**
 * data-saver.ts — user-controlled bandwidth budget.
 *
 * Lets users force a low-data experience even on a fast connection (mirrors
 * Twitter's "Data Saver" mode, which cut image data 50–80%). When enabled we
 * serve smallest images and skip all speculative preloading. Persisted to
 * localStorage; a window event lets mounted images re-resolve on change.
 */

const DATA_SAVER_KEY = "vault-data-saver";
export const DATA_SAVER_EVENT = "data-saver-change";

export function isDataSaver(): boolean {
  try {
    return localStorage.getItem(DATA_SAVER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDataSaver(on: boolean): void {
  try {
    localStorage.setItem(DATA_SAVER_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  // Notify listeners (OptimizedImage reacts by re-resolving its src).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DATA_SAVER_EVENT));
  }
}
