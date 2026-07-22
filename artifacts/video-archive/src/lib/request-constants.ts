import type { ComponentType } from "react";
import { Clock, CheckCircle2, XCircle, CheckCircle } from "lucide-react";

export type StatusKey = "pending" | "approved" | "rejected" | "done";

export interface StatusConfig {
  label: string;
  color: string;
  bg: string;
  icon: ComponentType<{ className?: string }>;
}

export const STATUS_CONFIG: Record<StatusKey, StatusConfig> = {
  pending: {
    label: "Pending",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    color: "text-red-500",
    bg: "bg-red-500/10",
    icon: XCircle,
  },
  done: {
    label: "Completed",
    color: "text-green-500",
    bg: "bg-green-500/10",
    icon: CheckCircle,
  },
};

/** Human-readable status label with a check/cross suffix for display in detail views. */
export const STATUS_LABEL_DETAIL: Record<StatusKey, string> = {
  pending: "Pending",
  approved: "Approved ✓",
  rejected: "Rejected ✗",
  done: "Completed ✓",
};

/** Return config for any status string, falling back to "pending". */
export function getStatusConfig(status: string): StatusConfig {
  return STATUS_CONFIG[status as StatusKey] ?? STATUS_CONFIG.pending;
}
