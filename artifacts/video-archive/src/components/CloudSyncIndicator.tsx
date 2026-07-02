import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useSyncStatus } from "@/contexts/SyncStatusContext";
import { Cloud, CloudOff, Loader2 } from "lucide-react";

interface CloudSyncIndicatorProps {
  /**
   * When true, shows as a compact inline badge (used inside page headers / navbar).
   * When false, shows as a full indicator with label.
   * @default false
   */
  compact?: boolean;
}

export function CloudSyncIndicator({
  compact = false,
}: CloudSyncIndicatorProps) {
  const { user, loading } = useAuth();
  const { isSyncing, pendingCount } = useSyncStatus();

  // ── Syncing state (takes priority) ────────────────────────────
  if (user && isSyncing) {
    if (compact) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-400/80">
          <Loader2 className="w-3 h-3 animate-spin" />
          {pendingCount > 1 ? `${pendingCount} queued` : "saving"}
        </span>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>
          {pendingCount > 1
            ? `${pendingCount} changes saving…`
            : "Saving…"}
        </span>
      </div>
    );
  }

  // ── Loading auth state ────────────────────────────────────────
  if (loading) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
        <div className="w-3 h-3 rounded-full border border-muted-foreground/20 border-t-transparent animate-spin" />
        Checking…
      </div>
    );
  }

  // ── Signed-in, idle ───────────────────────────────────────────
  if (user) {
    if (compact) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-primary/60">
          <Cloud className="w-3 h-3" />
          synced
        </span>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-primary/60">
        <Cloud className="w-3 h-3" />
        <span>Cloud sync</span>
      </div>
    );
  }

  // ── Guest / signed-out ────────────────────────────────────────
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/30">
        <CloudOff className="w-3 h-3" />
        local
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
      <CloudOff className="w-3 h-3" />
      <span>Local only</span>
      <Link
        href="/login"
        className="ml-1 text-primary/60 hover:text-primary underline underline-offset-2 transition-colors"
      >
        Sign in
      </Link>
    </div>
  );
}
