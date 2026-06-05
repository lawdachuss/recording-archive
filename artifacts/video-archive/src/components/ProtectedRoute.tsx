import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  children: React.ReactNode;
  requiredRole?: "moderator" | "admin";
}

export function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, loading, role } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setLocation("/login");
      return;
    }
    if (requiredRole) {
      const hierarchy = { user: 0, moderator: 1, admin: 2 };
      const userLevel = hierarchy[role ?? "user"] ?? 0;
      const requiredLevel = hierarchy[requiredRole] ?? 0;
      if (userLevel < requiredLevel) {
        setLocation("/");
      }
    }
  }, [user, loading, role, requiredRole, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;
  if (requiredRole) {
    const hierarchy = { user: 0, moderator: 1, admin: 2 };
    if ((hierarchy[role ?? "user"] ?? 0) < (hierarchy[requiredRole] ?? 0)) return null;
  }

  return <>{children}</>;
}
