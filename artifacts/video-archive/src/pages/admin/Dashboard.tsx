import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { resolveApiPath } from "@/lib/api-base";
import {
  Users, ListOrdered, Video, Shield,
  TrendingUp, Activity, Clock, Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AdminStats {
  users: number;
  recordings: number;
  performers: number;
  requests: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    done: number;
  };
}

const STAT_CARDS = [
  { label: "Total Users", key: "users" as const, icon: Users, color: "text-blue-400" },
  { label: "Recordings", key: "recordings" as const, icon: Video, color: "text-green-400" },
  { label: "Performers", key: "performers" as const, icon: TrendingUp, color: "text-orange-400" },
  { label: "Total Requests", key: "requests_total" as const, icon: ListOrdered, color: "text-purple-400" },
];

const REQUEST_STATUS_CARDS = [
  { label: "Pending", key: "pending" as const, icon: Clock, color: "text-yellow-400", variant: "pending" as const },
  { label: "Approved", key: "approved" as const, icon: Activity, color: "text-green-400", variant: "approved" as const },
  { label: "Rejected", key: "rejected" as const, icon: Shield, color: "text-red-400", variant: "rejected" as const },
  { label: "Done", key: "done" as const, icon: Shield, color: "text-primary", variant: "done" as const },
];

function getAuthHeaders(): Record<string, string> {
  const token = (window as any).__auth_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export default function AdminDashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (window as any).__auth_token = session?.access_token;
  }, [session]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = session?.access_token;
      const res = await fetch(resolveApiPath("/api/admin/stats"), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session?.access_token) loadStats();
  }, [session, loadStats]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-8">
          <div className="h-6 w-48 bg-muted/50 rounded animate-pulse mb-2" />
          <div className="h-4 w-64 bg-muted/30 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
          Failed to load dashboard: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-2">
          <Shield className="w-3.5 h-3.5 text-primary" />
          Dashboard
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">
          Overview
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Site statistics and request summary
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {STAT_CARDS.map(({ label, key, icon: Icon, color }) => (
          <Card key={key}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                    {label}
                  </p>
                  <p className="text-3xl font-black tracking-tighter mt-1">
                    {key === "requests_total" ? stats?.requests?.total ?? 0
                      : stats?.[key] ?? 0}
                  </p>
                </div>
                <div className={`w-10 h-10 rounded-lg bg-background border border-border/40 flex items-center justify-center ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-bold tracking-tight mb-4">Request Status Distribution</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {REQUEST_STATUS_CARDS.map(({ label, key, icon: Icon, color, variant }) => (
            <Card key={key}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Icon className={`w-5 h-5 ${color}`} />
                  <div>
                    <p className="text-2xl font-black tracking-tighter">
                      {stats?.requests?.[key] ?? 0}
                    </p>
                    <Badge variant={variant} className="mt-1">
                      {label}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold tracking-tight">
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <a
              href="/admin/requests"
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all rounded-md"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              View all requests
            </a>
            <a
              href="/admin/users"
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all rounded-md"
            >
              <Users className="w-3.5 h-3.5" />
              Manage users
            </a>
            <a
              href="/admin/cache"
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all rounded-md"
            >
              <Database className="w-3.5 h-3.5" />
              Cache settings
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
