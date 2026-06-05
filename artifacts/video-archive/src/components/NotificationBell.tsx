import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type UserNotification } from "@/lib/user-api";
import { Bell, X, CheckCheck } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["user", "notifications"],
    queryFn: () => userApi.getNotifications(),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  const markAllRead = useMutation({
    mutationFn: () => userApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "notifications"] }),
  });

  const deleteOne = useMutation({
    mutationFn: (id: number) => userApi.deleteNotification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "notifications"] }),
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) return null;

  const unread = notifications.filter((n: UserNotification) => !n.is_read).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground transition-colors rounded"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-background border border-border/60 rounded-sm shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
            <span className="text-xs font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground/50">
                No notifications
              </div>
            ) : (
              notifications.map((n: UserNotification) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-2 px-3 py-2.5 border-b border-border/30 last:border-0 ${
                    !n.is_read ? "bg-primary/5" : ""
                  }`}
                >
                  {!n.is_read && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-relaxed">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {formatRelativeTime(n.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteOne.mutate(n.id)}
                    className="shrink-0 text-muted-foreground/30 hover:text-muted-foreground transition-colors mt-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border/40 py-1.5 px-3">
            <Link href="/notifications">
              <span
                onClick={() => setOpen(false)}
                className="text-[11px] text-primary hover:underline cursor-pointer"
              >
                View all notifications →
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
