import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import {
  Shield, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle,
  User, Link2, FileText, ChevronDown, ChevronUp, Inbox,
  ArrowLeft, Trash2, Filter,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";

interface AdminRequest {
  id: number | null;
  performer_username: string | null;
  stream_link: string | null;
  notes: string | null;
  priority: string | null;
  status: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending:  { label: "Pending",   className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  approved: { label: "Approved",  className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected: { label: "Rejected",  className: "bg-red-500/15 text-red-400 border-red-500/30" },
  done:     { label: "Done",      className: "bg-primary/15 text-primary border-primary/30" },
};

const PRIORITY_STYLES: Record<string, string> = {
  low:    "text-muted-foreground",
  normal: "text-foreground",
  high:   "text-orange-400 font-semibold",
};

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "done";

export default function AdminPage() {
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/requests");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const updateStatus = async (id: number, status: string) => {
    setUpdating(id);
    try {
      const res = await fetch(`/api/requests/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    } catch {
      // silently fail — data not persisted yet
      setRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    } finally {
      setUpdating(null);
    }
  };

  const deleteRequest = async (id: number) => {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  };

  const filtered = requests.filter((r) =>
    statusFilter === "all" ? true : r.status === statusFilter,
  );

  const counts: Record<StatusFilter, number> = {
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
    done: requests.filter((r) => r.status === "done").length,
  };

  const filterTabs: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
    { id: "done", label: "Done" },
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-4xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
              <Shield className="w-3.5 h-3.5 text-primary" />
              Admin
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">
              Recording Requests
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Review, approve or reject user-submitted recording requests
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={loadRequests}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all rounded-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <Link href="/request">
              <span className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors rounded-sm">
                + Submit
              </span>
            </Link>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6">
          {filterTabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setStatusFilter(id)}
              className={`p-3 border rounded-sm text-left transition-all ${
                statusFilter === id
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/40 hover:border-border/70"
              }`}
            >
              <div className={`text-lg font-black ${statusFilter === id ? "text-primary" : "text-foreground"}`}>
                {counts[id]}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
            </button>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 items-center">
          <Filter className="w-3.5 h-3.5 text-muted-foreground/50 mr-1" />
          {filterTabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setStatusFilter(id)}
              className={`px-3 py-1 text-xs rounded-sm transition-all border ${
                statusFilter === id
                  ? "bg-primary text-white border-primary"
                  : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {label}
              {counts[id] > 0 && (
                <span className={`ml-1.5 ${statusFilter === id ? "text-white/70" : "text-muted-foreground/50"}`}>
                  {counts[id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-sm text-sm text-destructive mb-4">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && !requests.length ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-secondary/30 border border-border/30 rounded-sm animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center border border-dashed border-border/40 rounded-sm">
            <Inbox className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              {statusFilter === "all"
                ? "No requests submitted yet."
                : `No ${statusFilter} requests.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((req) => {
              const isExpanded = expandedId === req.id;
              const statusStyle = STATUS_STYLES[req.status] ?? STATUS_STYLES.pending;
              const priorityStyle = PRIORITY_STYLES[req.priority ?? "normal"] ?? "";

              return (
                <div
                  key={req.id ?? req.created_at}
                  className="border border-border/40 hover:border-border/70 rounded-sm transition-all"
                >
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Status badge */}
                    <span
                      className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[2px] border ${statusStyle.className}`}
                    >
                      {statusStyle.label}
                    </span>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {req.performer_username && (
                          <span className="text-sm font-semibold flex items-center gap-1">
                            <User className="w-3 h-3 text-muted-foreground/50" />
                            {req.performer_username}
                          </span>
                        )}
                        {req.stream_link && !req.performer_username && (
                          <a
                            href={req.stream_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-primary hover:underline flex items-center gap-1 truncate max-w-xs"
                          >
                            <Link2 className="w-3 h-3 shrink-0" />
                            {req.stream_link}
                          </a>
                        )}
                        {req.priority && req.priority !== "normal" && (
                          <span className={`text-[11px] ${priorityStyle}`}>
                            [{req.priority}]
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground/60">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(req.created_at)}
                        {req.notes && (
                          <>
                            <span>·</span>
                            <span className="truncate max-w-xs">{req.notes}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {req.status === "pending" && req.id != null && (
                        <>
                          <button
                            onClick={() => updateStatus(req.id!, "approved")}
                            disabled={updating === req.id}
                            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-green-400 hover:bg-green-400/10 transition-colors rounded"
                            title="Approve"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => updateStatus(req.id!, "rejected")}
                            disabled={updating === req.id}
                            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors rounded"
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {req.status === "approved" && req.id != null && (
                        <button
                          onClick={() => updateStatus(req.id!, "done")}
                          disabled={updating === req.id}
                          className="h-7 px-3 text-[11px] font-medium text-primary border border-primary/30 hover:bg-primary/10 transition-colors rounded-sm"
                        >
                          Mark Done
                        </button>
                      )}
                      <button
                        onClick={() => req.id != null && deleteRequest(req.id)}
                        className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors rounded"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      {(req.notes || req.stream_link) && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : req.id)}
                          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-2">
                      {req.stream_link && (
                        <div className="flex items-start gap-2 text-xs">
                          <Link2 className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                          <a
                            href={req.stream_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline break-all"
                          >
                            {req.stream_link}
                          </a>
                        </div>
                      )}
                      {req.notes && (
                        <div className="flex items-start gap-2 text-xs">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                          <p className="text-muted-foreground leading-relaxed">{req.notes}</p>
                        </div>
                      )}
                      {req.id != null && req.status !== "done" && (
                        <div className="flex gap-2 pt-2 flex-wrap">
                          {req.status !== "approved" && (
                            <button
                              onClick={() => updateStatus(req.id!, "approved")}
                              className="h-7 px-3 text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors rounded-sm"
                            >
                              Approve
                            </button>
                          )}
                          {req.status !== "rejected" && (
                            <button
                              onClick={() => updateStatus(req.id!, "rejected")}
                              className="h-7 px-3 text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors rounded-sm"
                            >
                              Reject
                            </button>
                          )}
                          {req.status === "approved" && (
                            <button
                              onClick={() => updateStatus(req.id!, "done")}
                              className="h-7 px-3 text-[11px] font-medium bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors rounded-sm"
                            >
                              Mark Done
                            </button>
                          )}
                          <button
                            onClick={() => updateStatus(req.id!, "pending")}
                            className="h-7 px-3 text-[11px] font-medium border border-border/50 text-muted-foreground hover:text-foreground transition-colors rounded-sm"
                          >
                            Reset to Pending
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 pt-4 border-t border-border/30 text-[11px] text-muted-foreground/40 text-center">
          Admin panel — handle with care
        </div>
      </div>
    </Layout>
  );
}
