import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { resolveApiPath } from "@/lib/api-base";
import {
  Shield, RefreshCw, Trash2, Mail, Calendar,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatRelativeTime } from "@/lib/formatters";

interface AdminUser {
  user_id: string;
  display_name: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  role: string;
}

const VALID_ROLES = ["user", "moderator", "admin"];

export default function AdminUsers() {
  const { session, user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, [session]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(resolveApiPath("/api/admin/users"), {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    if (session?.access_token) loadUsers();
  }, [session, loadUsers]);

  const updateRole = async (userId: string, newRole: string) => {
    setUpdating(userId);
    try {
      const res = await fetch(resolveApiPath(`/api/admin/users/${userId}/role`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers((prev) => prev.map((u) => (u.user_id === userId ? { ...u, role: newRole } : u)));
    } catch {
      loadUsers();
    } finally {
      setUpdating(null);
    }
  };

  const deleteUser = async (userId: string) => {
    if (userId === currentUser?.id) {
      alert("You cannot delete your own account.");
      return;
    }
    const confirmed = window.confirm(
      `Delete user ${users.find((u) => u.user_id === userId)?.email ?? userId}? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(resolveApiPath(`/api/admin/users/${userId}`), {
        method: "DELETE",
        headers: headers(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers((prev) => prev.filter((u) => u.user_id !== userId));
    } catch {
      loadUsers();
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
          <h1 className="text-2xl font-black tracking-tighter">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage user roles and accounts
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && !users.length ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No users found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {(u.display_name ?? u.username ?? u.email ?? "U").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="text-sm font-medium">
                            {u.display_name ?? u.username ?? "Unknown"}
                          </div>
                          {u.username && u.display_name && (
                            <div className="text-[11px] text-muted-foreground">
                              @{u.username}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="w-3.5 h-3.5" />
                        {u.email ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={u.role as any}>
                          {u.role}
                        </Badge>
                        {u.user_id === currentUser?.id && (
                          <span className="text-[10px] text-muted-foreground">(you)</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {formatRelativeTime(u.created_at)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Select
                          value={u.role}
                          onValueChange={(v) => updateRole(u.user_id, v)}
                          disabled={updating === u.user_id}
                        >
                          <SelectTrigger className="h-8 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VALID_ROLES.map((role) => (
                              <SelectItem key={role} value={role} className="text-xs">
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => deleteUser(u.user_id)}
                          disabled={u.user_id === currentUser?.id}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title="Delete user"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
