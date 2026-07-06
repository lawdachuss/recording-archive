import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { resolveApiPath } from "@/lib/api-base";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: "user" | "moderator" | "admin" | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    email: string,
    password: string,
    username?: string,
  ) => Promise<{ error?: string; needsVerification?: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  resolveUsername: (username: string) => Promise<{ email?: string; error?: string }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchRole(token: string): Promise<"user" | "moderator" | "admin"> {
  try {
    const res = await fetch(resolveApiPath("/api/user/role"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { role: string };
      if (
        data.role === "moderator" ||
        data.role === "admin" ||
        data.role === "user"
      ) {
        return data.role;
      }
    }
  } catch {}
  return "user";
}

async function applyPendingUsername(token: string) {
  const pending = localStorage.getItem("pendingUsername");
  if (!pending) return;
  localStorage.removeItem("pendingUsername");
  try {
    await fetch(resolveApiPath("/api/user/profile"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username: pending }),
    });
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"user" | "moderator" | "admin" | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.access_token) {
        setRole(null);
        fetchRole(session.access_token).then(setRole);
        applyPendingUsername(session.access_token);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.access_token) {
        setRole(null);
        fetchRole(session.access_token).then(setRole);
        applyPendingUsername(session.access_token);
      } else {
        setRole(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (
    email: string,
    password: string,
  ): Promise<{ error?: string }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    if (data.session?.access_token) {
      setSession(data.session);
      setUser(data.session.user);
      setRole(null);
      fetchRole(data.session.access_token).then(setRole);
      applyPendingUsername(data.session.access_token);
    }
    return {};
  };

  const signUp = async (
    email: string,
    password: string,
    username?: string,
  ): Promise<{ error?: string; needsVerification?: boolean }> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: username, username } },
    });
    if (error) return { error: error.message };
    if (data.user && !data.session) {
      if (username) localStorage.setItem("pendingUsername", username);
      return { needsVerification: true };
    }
    if (username && data.session?.access_token) {
      try {
        await fetch(resolveApiPath("/api/user/profile"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: JSON.stringify({ username }),
        });
      } catch {}
    }
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setRole(null);
  };

  const resetPassword = async (email: string): Promise<{ error?: string }> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    if (error) return { error: error.message };
    return {};
  };

  const resolveUsername = async (username: string): Promise<{ email?: string; error?: string }> => {
    try {
      const res = await fetch(resolveApiPath(`/api/user/resolve-username?username=${encodeURIComponent(username)}`));
      if (!res.ok) {
        if (res.status === 404) return { error: "Username not found" };
        return { error: "Failed to resolve username" };
      }
      const data = (await res.json()) as { email: string };
      return { email: data.email };
    } catch {
      return { error: "Network error" };
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, session, loading, role, signIn, signUp, signOut, resetPassword, resolveUsername }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
