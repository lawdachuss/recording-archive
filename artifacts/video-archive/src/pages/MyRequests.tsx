import { Link } from "wouter";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useMyRequests, useDeleteRequest, type UserRequest } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { userApi, type UserNotification } from "@/lib/user-api";
import { formatRelativeTime } from "@/lib/formatters";
import { toast } from "@/hooks/use-toast";
import {
  Send, Loader2, ExternalLink, ArrowLeft, ListFilter, Trash2,
  ChevronLeft, ChevronRight, XCircle,
} from "lucide-react";
import { getStatusConfig } from "@/lib/request-constants";

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "done";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "done", label: "Completed" },
];

const REQUESTS_PER_PAGE = 15;

function RequestCard({ request, onDelete, onViewRequest }: { request: UserRequest; onDelete?: () => void; onViewRequest?: () => void }) {
  const cfg = getStatusConfig(request.status);
  const StatusIcon = cfg.icon;
  const performerName = request.performer_username ?? "—";
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete request for @${performerName}?`)) return;
    setDeleting(true);
    try {
      await onDelete?.();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group relative">
      <Link
        href={`/request?id=${request.id}`}
        className="block rounded-lg border border-border/30 bg-card hover:border-primary/30 transition-all duration-200 overflow-hidden"
        onClick={() => onViewRequest?.()}
      >
        <div className="p-4 flex items-start gap-4">
          {/* Status icon */}
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cfg.bg} group-hover:scale-105 transition-transform`}>
            <StatusIcon className={`w-5 h-5 ${cfg.color}`} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-foreground truncate">
                @{performerName}
              </span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] ${cfg.bg} ${cfg.color}`}>
                {cfg.label}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground/60">
              <span className="capitalize">{request.platform}</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="capitalize">{request.priority}</span>
              <span className="text-muted-foreground/30">·</span>
              <span>{formatRelativeTime(request.created_at)}</span>
            </div>

            {request.notes && (
              <p className="text-[11px] text-muted-foreground/50 mt-1.5 line-clamp-1">
                {request.notes}
              </p>
            )}
          </div>

          {/* Arrow */}
          <div className="shrink-0 self-center text-muted-foreground/30 group-hover:text-primary/50 transition-colors">
            <ExternalLink className="w-4 h-4" />
          </div>
        </div>
      </Link>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 bg-background/80 hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive border border-border/30 hover:border-destructive/30 transition-all"
        title="Delete request"
        aria-label="Delete request"
      >
        {deleting ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Trash2 className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

export default function MyRequests() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const { data: requests = [], isLoading, isError } = useMyRequests({ enabled: !!user });

  // Reset to page 1 when filter changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const r of requests) {
      c[r.status] = (c[r.status] ?? 0) + 1;
    }
    return c;
  }, [requests]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredRequests.length / REQUESTS_PER_PAGE)),
    [filteredRequests],
  );

  const safePage = Math.min(page, totalPages);

  const paginatedRequests = useMemo(
    () => filteredRequests.slice((safePage - 1) * REQUESTS_PER_PAGE, safePage * REQUESTS_PER_PAGE),
    [filteredRequests, safePage],
  );

  // Fetch notifications to mark related ones as read when viewing a request
  const { data: notifications = [] } = useQuery({
    queryKey: ["user", "notifications"],
    queryFn: () => userApi.getNotifications(),
    enabled: !!user,
    staleTime: 10_000,
  });

  // Build a map: request ID → notification IDs
  const requestNotifMap = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const n of notifications as UserNotification[]) {
      if (!n.related_id) continue;
      const reqId = parseInt(n.related_id, 10);
      if (isNaN(reqId)) continue;
      const existing = map.get(reqId) ?? [];
      existing.push(n.id);
      map.set(reqId, existing);
    }
    return map;
  }, [notifications]);

  const markOneRead = useTrackedMutation({
    mutationFn: (ids: number[]) =>
      userApi.markAsReadBatch(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "notifications"] }),
  });

  const queryClient = useQueryClient();
  const deleteRequest = useDeleteRequest();

  const handleDelete = (id: number) => async () => {
    try {
      await deleteRequest.mutateAsync(id);
      toast({ title: "Deleted", description: "Request has been deleted." });
    } catch {
      toast({ title: "Error", description: "Failed to delete request.", variant: "destructive" });
    }
  };

  if (!user) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-muted-foreground">Please sign in to view your requests.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              href="/request"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="w-3 h-3" />
              New request
            </Link>
            <h1 className="text-xl font-black tracking-tight text-foreground">
              My Requests
            </h1>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              Track the status of your submitted requests
            </p>
          </div>
          <Link
            href="/request"
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium border border-primary/30 text-primary hover:border-primary/60 rounded-sm transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            New Request
          </Link>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-primary/60 animate-spin" />
          </div>
        ) : isError ? (
          <div className="py-20 text-center">
            <XCircle className="w-10 h-10 text-destructive/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Failed to load requests.</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Please try again later.</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="py-20 text-center border border-border/30 rounded-lg bg-card/50">
            <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <Send className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <h2 className="text-base font-bold text-foreground mb-1">No requests yet</h2>
            <p className="text-xs text-muted-foreground/60 mb-6 max-w-xs mx-auto">
              Submit a request for a performer you'd like to see recorded in the archive.
            </p>
            <Link
              href="/request"
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium border border-primary/30 text-primary hover:border-primary/60 rounded-sm transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              Submit Your First Request
            </Link>
          </div>
        ) : (
          <>
            {/* Filter tabs */}
            <div className="flex items-center gap-1 mb-5 overflow-x-auto">
              <ListFilter className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 mr-1" />
              {FILTERS.map(({ key, label }) => {
                const isActive = statusFilter === key;
                const count = counts[key] ?? 0;
                return (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className={`relative inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-sm border transition-all shrink-0 ${
                      isActive
                        ? (key === "all"
                            ? "border-primary/50 text-primary bg-primary/5"
                            : `${getStatusConfig(key)?.bg} ${getStatusConfig(key)?.color} border-${getStatusConfig(key)?.color.replace("text-", "")}/30`
                          )
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {label}
                    <span className={`text-[10px] ${isActive ? "opacity-80" : "text-muted-foreground/50"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filtered list */}
            {filteredRequests.length === 0 ? (
              <div className="py-16 text-center border border-border/30 rounded-lg bg-card/50">
                <ListFilter className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No {statusFilter} requests</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {paginatedRequests.map((request) => (
                    <RequestCard
                      key={request.id}
                      request={request}
                      onDelete={handleDelete(request.id)}
                      onViewRequest={() => {
                        const ids = requestNotifMap.get(request.id);
                        if (ids && ids.length > 0) {
                          markOneRead.mutate(ids);
                        }
                      }}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-6 flex items-center justify-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-sm border border-border/50 text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-30 disabled:pointer-events-none transition-all"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    {(() => {
                      const pages: (number | "...")[] = [];
                      const range = 2;
                      pages.push(1);
                      if (safePage - range > 2) pages.push("...");
                      for (let i = Math.max(2, safePage - range); i <= Math.min(totalPages - 1, safePage + range); i++) {
                        pages.push(i);
                      }
                      if (safePage + range < totalPages - 1) pages.push("...");
                      if (totalPages > 1) pages.push(totalPages);
                      return pages;
                    })().map((p, i) =>
                      p === "..." ? (
                        <span key={`ellipsis-${i}`} className="w-8 text-center text-[11px] text-muted-foreground/30">
                          …
                        </span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`inline-flex items-center justify-center w-8 h-8 text-xs font-medium rounded-sm border transition-all ${
                            p === safePage
                              ? "border-primary/50 text-primary bg-primary/5"
                              : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                          }`}
                        >
                          {p}
                        </button>
                      ),
                    )}

                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-sm border border-border/50 text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-30 disabled:pointer-events-none transition-all"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>

                    <span className="ml-2 text-[11px] text-muted-foreground/50">
                      {filteredRequests.length} total
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
