/**
 * use-connection-quality.ts — constrained-connection state.
 *
 * Automatic slow-connection detection and the Data Saver toggle were removed,
 * so this hook is now a constant `false`. Kept only so existing call sites
 * don't need to change; new code should not use it.
 */

import { isConnectionConstrained } from "@/lib/connection";

export function useConnectionConstrained(): boolean {
  return isConnectionConstrained();
}
