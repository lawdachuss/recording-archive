/**
 * gating.ts — small persistent-flag/store helpers shared by the age gate,
 * the ad grace window and the premium upsell popup.
 *
 * All values live in localStorage so each device gets exactly:
 *   - one age-gate confirmation,
 *   - one ad-free grace window ever (set the first time the gate is passed),
 *   - at most one premium upsell popup per 24h.
 */

const AGE_KEY = "age-gate-passed";
const GRACE_KEY = "vault_grace_started_at";
const UPSELL_KEY = "vault_upsell_shown_at";

/** Custom event dispatched when the age gate is confirmed (same-tab signal). */
export const AGE_GATE_EVENT = "vault:age-gate-passed";

export function isAgeGatePassed(): boolean {
  try {
    return localStorage.getItem(AGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Mark the age gate as passed and notify listeners. Returns the ISO timestamp
 * the grace window started (or the existing one — the window is once-per-device).
 */
export function markAgeGatePassed(): string | null {
  const now = new Date().toISOString();
  try {
    localStorage.setItem(AGE_KEY, "true");
    if (!localStorage.getItem(GRACE_KEY)) {
      localStorage.setItem(GRACE_KEY, now);
    }
    window.dispatchEvent(new CustomEvent(AGE_GATE_EVENT));
  } catch {
    /* storage unavailable — treat as passed for the session */
  }
  return getGraceStart();
}

export function getGraceStart(): string | null {
  try {
    return localStorage.getItem(GRACE_KEY);
  } catch {
    return null;
  }
}

/**
 * Start the once-per-device grace window for visitors who already passed the
 * age gate before this feature shipped (no grace timestamp exists yet). Without
 * this, returning visitors would get zero ad-free minutes and ads + the upsell
 * popup on their very first load after rollout.
 */
export function ensureGraceStarted(): void {
  try {
    if (localStorage.getItem(AGE_KEY) === "true" && !localStorage.getItem(GRACE_KEY)) {
      localStorage.setItem(GRACE_KEY, new Date().toISOString());
    }
  } catch {
    /* storage unavailable — fall back to zero grace */
  }
}

/** Milliseconds of the once-per-device ad-free grace window remaining. */
export function getGraceRemainingMs(graceMinutes: number): number {
  const start = getGraceStart();
  if (!start) return 0;
  const started = new Date(start).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, started + graceMinutes * 60_000 - Date.now());
}

/** Register a listener for the age-gate-passed event. Returns an unsubscribe fn. */
export function onAgeGatePassed(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(AGE_GATE_EVENT, handler);
  return () => window.removeEventListener(AGE_GATE_EVENT, handler);
}

/** Whether the one-per-24h upsell popup was already shown on this device. */
export function wasUpsellShown(delayMs: number): boolean {
  try {
    const at = localStorage.getItem(UPSELL_KEY);
    if (!at) return false;
    return Date.now() - new Date(at).getTime() < delayMs;
  } catch {
    return false;
  }
}

export function markUpsellShown(): void {
  try {
    localStorage.setItem(UPSELL_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}