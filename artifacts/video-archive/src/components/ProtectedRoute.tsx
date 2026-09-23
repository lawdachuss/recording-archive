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
    if (loading) return;
    // Unauthenticated (expired session / signed out) — always bounce to
    // login, even before any role exists. Waiting for `role` here used to
    // strand logged-out visitors on the spinner forever.
    if (!user) {
      const redirectTo = location && location !== "/" ? `?redirect=${encodeURIComponent(location)}` : "";
      setLocation(`/login${redirectTo}`);
      return;
    }
    // Authenticated — wait for the role before judging authorization.
    if (requiredRole && role === null) return;
    if (!isAuthorized) {
      setLocation("/");
    }
  }, [user, loading, role, requiredRole, isAuthorized, location]);

  // Spinner while: the session is loading, the login redirect is in flight,
  // or an authenticated user's role is still being fetched (transient — the
  // role fetch always resolves, with a network timeout fallback).
  if (loading || !user || (requiredRole && role === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthorized) return null;

  return <>{children}</>;
}
