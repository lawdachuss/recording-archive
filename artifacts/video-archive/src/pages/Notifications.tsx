import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type UserNotification } from "@/lib/user-api";
import { formatRelativeTime } from "@/lib/formatters";
import { Bell, BellOff, CheckCheck, X, Trash2 } from "lucide-react";

export default function Notifications() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["user", "notifications"],
    queryFn: () => userApi.getNotifications(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const markAll = useMutation({
    mutationFn: () => userApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "notifications"] }),
  });

  const deleteOne = useMutation({
    mutationFn: (id: number) => userApi.deleteNotification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "notifications"] }),
  });

  if (!user) return null;

  const unread = notifications.filter((n: UserNotification) => !n.is_read).length;

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-border/40">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Bell className="w-5 h-5 text-primary" />
              Notifications
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {unread > 0 ? `${unread} unread` : "All caught up"}
            </p>
          </div>
          {unread > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-secondary/30 border border-border/30 rounded-sm animate-pulse" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <BellOff className="w-10 h-10 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground/50 mb-1">No notifications</p>
            <p className="text-xs text-muted-foreground/30">
              You'll see notifications about new content here.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {notifications.map((n: UserNotification) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 px-4 py-3 border rounded-sm transition-all ${
                  !n.is_read
                    ? "border-primary/20 bg-primary/5"
                    : "border-border/40 hover:border-border/60"
                }`}
              >
                {!n.is_read && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-relaxed">{n.message}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                    {formatRelativeTime(n.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => deleteOne.mutate(n.id)}
                  disabled={deleteOne.isPending}
                  className="shrink-0 flex items-center justify-center w-7 h-7 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors rounded mt-0.5"
                  title="Delete"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {notifications.length > 0 && (
              <div className="pt-4 border-t border-border/30 flex justify-end">
                <button
                  onClick={() =>
                    notifications.forEach((n: UserNotification) => deleteOne.mutate(n.id))
                  }
                  className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
