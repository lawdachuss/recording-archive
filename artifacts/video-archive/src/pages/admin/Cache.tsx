import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { resolveApiPath } from "@/lib/api-base";
import {
  Shield, RefreshCw, Database, Zap, AlertTriangle,
  Trash2, Info, Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

interface CacheStatus {
  connected: boolean;
  status: string;
  keys?: number;
}

export default function AdminCache() {
  const { session } = useAuth();
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [invalidateTags, setInvalidateTags] = useState("");
  const [invalidatePattern, setInvalidatePattern] = useState("");

  const headers = useCallback(() => {
    const token = session?.access_token;
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [session]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(resolveApiPath("/api/admin/cache/status"), {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    if (session?.access_token) loadStatus();
  }, [session, loadStatus]);

  const doAction = async (action: string, url: string, method = "POST", body?: any) => {
    setActionLoading(action);
    setResult(null);
    try {
      const res = await fetch(resolveApiPath(url), {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult({ type: "success", message: `${action}: ${JSON.stringify(data)}` });
      if (action === "Refresh Status" || action === "Flush") loadStatus();
    } catch (e: any) {
      setResult({ type: "error", message: `${action} failed: ${e.message}` });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-2">
            <Shield className="w-3.5 h-3.5 text-primary" />
            Admin
          </div>
          <h1 className="text-2xl font-black tracking-tighter">Cache Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and manage Redis cache
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {result && (
        <div className={`flex items-start gap-2 p-4 mb-4 rounded-md text-sm border ${
          result.type === "success"
            ? "bg-green-500/10 border-green-500/30 text-green-400"
            : "bg-destructive/10 border-destructive/30 text-destructive"
        }`}>
          {result.type === "success" ? <Activity className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <div className="font-mono text-xs">{result.message}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Cache Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading && !status ? (
              <div className="h-20 bg-muted/30 rounded animate-pulse" />
            ) : status ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Connection</span>
                  <Badge variant={status.connected ? "approved" : "rejected"}>
                    {status.connected ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border/30">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <span className="text-sm font-medium">{status.status}</span>
                </div>
                {status.keys !== undefined && (
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-muted-foreground">Total Keys</span>
                    <span className="text-lg font-black">{status.keys}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-destructive">Failed to fetch cache status</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start h-10"
              onClick={() => doAction("Purge All", "/api/admin/cache/purge")}
              disabled={actionLoading !== null}
            >
              <Trash2 className="w-4 h-4 text-orange-400" />
              Purge All Cache
              <span className="text-xs text-muted-foreground ml-auto">(performers, recordings, stats, tags)</span>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-10"
              onClick={() => doAction("Flush", "/api/admin/cache/flush", "DELETE")}
              disabled={actionLoading !== null}
            >
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Flush All Redis Keys
              <span className="text-xs text-muted-foreground ml-auto">(api:* and tag:* keys)</span>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              Invalidate by Tags
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Comma-separated list of cache tags to invalidate.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. performers, recordings, stats"
                value={invalidateTags}
                onChange={(e) => setInvalidateTags(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => {
                  const tags = invalidateTags.split(",").map((t) => t.trim()).filter(Boolean);
                  if (tags.length > 0) {
                    doAction("Invalidate Tags", "/api/admin/cache/invalidate", "POST", { tags });
                  }
                }}
                disabled={actionLoading !== null || !invalidateTags.trim()}
              >
                Invalidate
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              Invalidate by Pattern
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Redis key pattern to match and delete.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. api:performers:*"
                value={invalidatePattern}
                onChange={(e) => setInvalidatePattern(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => {
                  if (invalidatePattern.trim()) {
                    doAction("Invalidate Pattern", "/api/admin/cache/invalidate", "POST", { pattern: invalidatePattern });
                  }
                }}
                disabled={actionLoading !== null || !invalidatePattern.trim()}
              >
                Invalidate
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
