/**
 * use-connection-quality.ts — live-reacting constrained-connection state.
 *
 * `isConnectionConstrained()` (connection.ts) is a pure function evaluated
 * once per call; components that call it in render never re-evaluate when the
 * underlying sources change. This hook subscribes to every source that can
 * flip the answer at runtime:
 *
 *   - navigator.connection "change" events (network quality varies live)
 *   - the adaptive-speed tier (measured thumbnail load times, adaptive-quality.ts)
 *   - the manual Data Saver toggle (data-saver.ts)
 *
 * Any change re-renders the component with the fresh value, so hover previews,
 * preloads, sprite animation, and page sizes adapt live with zero user action.
 */

import { useEffect, useState } from "react";
import { isConnectionConstrained } from "@/lib/connection";
import { ADAPTIVE_TIER_EVENT } from "@/lib/adaptive-quality";
import { DATA_SAVER_EVENT } from "@/lib/data-saver";

export function useConnectionConstrained(): boolean {
  const [constrained, setConstrained] = useState<boolean>(() => isConnectionConstrained());

  useEffect(() => {
    const refresh = () => setConstrained(isConnectionConstrained());
    window.addEventListener(ADAPTIVE_TIER_EVENT, refresh);
    window.addEventListener(DATA_SAVER_EVENT, refresh);
    // The Network Information API can report a different effectiveType at
    // runtime (e.g. 4g → 3g on congestion) without a full page reload.
    const nav = (navigator as { connection?: { addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void } }).connection;
    nav?.addEventListener?.("change", refresh);
    return () => {
      window.removeEventListener(ADAPTIVE_TIER_EVENT, refresh);
      window.removeEventListener(DATA_SAVER_EVENT, refresh);
      nav?.removeEventListener?.("change", refresh);
    };
  }, []);

  return constrained;
}