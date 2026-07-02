import { createContext, useContext, useState, useCallback, useRef } from "react";
import type {
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";

interface SyncStatusContextType {
  /** Number of currently in-flight mutations */
  pendingCount: number;
  /** True when there are any pending mutations */
  isSyncing: boolean;
  /** @internal Increment the pending counter */
  addPending: () => void;
  /** @internal Decrement the pending counter */
  removePending: () => void;
}

const SyncStatusContext = createContext<SyncStatusContextType | null>(null);

/**
 * Tracks the global count of in-flight mutations so UI components
 * (like CloudSyncIndicator) can show a "syncing…" state.
 *
 * Wrap your app with <SyncStatusProvider>.
 */
export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const countRef = useRef(0);

  const addPending = useCallback(() => {
    countRef.current += 1;
    setPendingCount(countRef.current);
  }, []);

  const removePending = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    setPendingCount(countRef.current);
  }, []);

  return (
    <SyncStatusContext.Provider
      value={{ pendingCount, isSyncing: pendingCount > 0, addPending, removePending }}
    >
      {children}
    </SyncStatusContext.Provider>
  );
}

/**
 * Hook to read the current sync status from anywhere in the tree.
 */
export function useSyncStatus(): SyncStatusContextType {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) {
    return { pendingCount: 0, isSyncing: false, addPending: () => {}, removePending: () => {} };
  }
  return ctx;
}

/**
 * Drop-in replacement for `useMutation` that automatically tracks
 * the mutation lifecycle in SyncStatusProvider.
 *
 * Increments the pending counter when the mutation starts,
 * decrements when it settles (success or error).
 */
export function useTrackedMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const { addPending, removePending } = useSyncStatus();

  return useMutation({
    ...options,
    onMutate(vars, ctx) {
      addPending();
      return options.onMutate?.(vars, ctx);
    },
    onSettled(data, error, vars, ctx, extra) {
      removePending();
      options.onSettled?.(data, error, vars, ctx, extra);
    },
  });
}
