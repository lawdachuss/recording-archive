import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  children: React.ReactNode;
  requiredRole?: "moderator" | "admin";
}

const hierarchy = { user: 0, moderator: 1, admin: 2 };

export function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, loading, role } = useAuth();
  const [location, setLocation] = useLocation();

  const isAuthorized = !requiredRole || (role != null && (hierarchy[role] ?? 0) >= (hierarchy[requiredRole] ?? 0));

  useEffect(() => {
    if (loading || (requiredRole && role === null)) return;
    if (!user) {
      const redirectTo = location && location !== "/" ? `?redirect=${encodeURIComponent(location)}` : "";
      setLocation(`/login${redirectTo}`);
      return;
    }
    if (!isAuthorized) {
      setLocation("/");
    }
  }, [user, loading, role, requiredRole, isAuthorized, location]);

  if (loading || (requiredRole && role === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;
  if (!isAuthorized) return null;

  return <>{children}</>;
}
