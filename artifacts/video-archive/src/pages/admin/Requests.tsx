import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { resolveApiPath } from "@/lib/api-base";
import {
  Shield, RefreshCw, CheckCircle2, XCircle, Clock,
  Trash2, Filter, ChevronDown, ChevronUp, User, Link2, FileText,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeTime } from "@/lib/formatters";

interface AdminRequest {
  id: number;
  user_id: string;
  platform: string;
  performer_username: string | null;
  stream_link: string | null;
  notes: string | null;
  priority: string;
  status: string;
  created_at: string;
  display_name: string | null;
  username: string | null;
  email: string | null;
}

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "done";

const FILTER_TABS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "done", label: "Done" },
];

export default function AdminRequests() {
  const { session } = useAuth();
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, [session]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(resolveApiPath(`/api/admin/requests${params}`), {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, headers]);

  useEffect(() => {
    if (session?.access_token) loadRequests();
  }, [session, loadRequests]);

  const updateStatus = async (id: number, newStatus: string) => {
    setUpdating(id);
    try {
      const res = await fetch(resolveApiPath(`/api/admin/requests/${id}/status`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
    } catch {
      loadRequests();
    } finally {
      setUpdating(null);
    }
  };

  const deleteRequest = async (id: number) => {
    const confirmed = window.confirm("Delete this request?");
    if (!confirmed) return;

    try {
      const res = await fetch(resolveApiPath(`/api/admin/requests/${id}`), {
        method: "DELETE",
        headers: headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch {
      loadRequests();
    }
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-2">
            <Shield className="w-3.5 h-3.5 text-primary" />
            Admin
          </div>
          <h1 className="text-2xl font-black tracking-tighter">Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and manage recording requests
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadRequests} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="mb-6">
        <TabsList>
          {FILTER_TABS.map(({ id, label }) => (
            <TabsTrigger key={id} value={id} className="relative">
              {label}
              {counts[id] > 0 && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {counts[id]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && !requests.length ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No {statusFilter === "all" ? "" : statusFilter} requests found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Performer</TableHead>
                  <TableHead>Submitted by</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((req) => (
                  <>
                    <TableRow
                      key={req.id}
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                    >
                      <TableCell>
                        <Badge variant={req.status as any}>
                          {req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-muted-foreground/50" />
                          {req.performer_username ?? (
                            <span className="text-muted-foreground italic">Direct link</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{req.username ?? req.email ?? req.user_id.slice(0, 8)}</span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium ${
                          req.priority === "high" ? "text-orange-400" :
                          req.priority === "low" ? "text-muted-foreground" : "text-foreground"
                        }`}>
                          {req.priority ?? "normal"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelativeTime(req.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {req.status === "pending" && (
                            <>
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => updateStatus(req.id, "approved")}
                                disabled={updating === req.id}
                                className="h-8 w-8 text-muted-foreground hover:text-green-400"
                                title="Approve"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => updateStatus(req.id, "rejected")}
                                disabled={updating === req.id}
                                className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {req.status === "approved" && (
                            <Button
                              variant="outline" size="sm"
                              onClick={() => updateStatus(req.id, "done")}
                              disabled={updating === req.id}
                              className="h-8 text-xs"
                            >
                              Mark Done
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => deleteRequest(req.id)}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                            className="h-8 w-8 text-muted-foreground"
                          >
                            {expandedId === req.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedId === req.id && (
                      <TableRow key={`${req.id}-expanded`}>
                        <TableCell colSpan={6} className="bg-muted/20">
                          <div className="px-4 py-3 space-y-2 text-sm">
                            {req.stream_link && (
                              <div className="flex items-start gap-2">
                                <Link2 className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                                <a href={req.stream_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                                  {req.stream_link}
                                </a>
                              </div>
                            )}
                            {req.notes && (
                              <div className="flex items-start gap-2">
                                <FileText className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                                <p className="text-muted-foreground">{req.notes}</p>
                              </div>
                            )}
                            <div className="flex items-start gap-2">
                              <Shield className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                              <span className="text-muted-foreground">
                                User ID: <code className="text-xs bg-muted/50 px-1 py-0.5 rounded">{req.user_id}</code>
                              </span>
                            </div>
                            {req.status !== "done" && (
                              <div className="flex gap-2 pt-2 border-t border-border/30">
                                {req.status !== "approved" && (
                                  <Button variant="outline" size="sm" onClick={() => updateStatus(req.id, "approved")} className="text-xs text-green-400 border-green-500/40 hover:bg-green-500/10">
                                    Approve
                                  </Button>
                                )}
                                {req.status !== "rejected" && (
                                  <Button variant="outline" size="sm" onClick={() => updateStatus(req.id, "rejected")} className="text-xs text-red-400 border-red-500/40 hover:bg-red-500/10">
                                    Reject
                                  </Button>
                                )}
                                {req.status === "approved" && (
                                  <Button variant="outline" size="sm" onClick={() => updateStatus(req.id, "done")} className="text-xs text-primary border-primary/30 hover:bg-primary/10">
                                    Mark Done
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={() => updateStatus(req.id, "pending")} className="text-xs">
                                  Reset to Pending
                                </Button>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
