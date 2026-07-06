import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Film, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function Login() {
  const { signIn, resolveUsername } = useAuth();
  const [location, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmail = email.includes("@");
  const locationSearch = location.includes("?")
    ? location.slice(location.indexOf("?"))
    : window.location.search;
  const requestedRedirect = new URLSearchParams(locationSearch).get("redirect");
  const redirectAfterLogin =
    requestedRedirect?.startsWith("/") && !requestedRedirect.startsWith("//")
      ? requestedRedirect
      : "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let loginEmail = email;
    if (!isEmail) {
      const resolved = await resolveUsername(email);
      if (resolved.error || !resolved.email) {
        setError(resolved.error ?? "Username not found");
        setLoading(false);
        return;
      }
      loginEmail = resolved.email;
    }

    const result = await signIn(loginEmail, password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setLocation(redirectAfterLogin);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="pattern-square fixed inset-0 pointer-events-none opacity-[0.15] dark:opacity-[0.30]" />
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-1.5 group mb-8">
            <Film className="w-5 h-5 text-primary" />
            <span className="font-black text-xl tracking-tighter text-foreground group-hover:text-primary transition-colors">
              VAULT<span className="text-primary">.</span>
            </span>
          </Link>
          <h1 className="text-2xl font-black tracking-tight mt-4">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Access your saved videos, collections and history
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-sm text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Email or Username
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              placeholder="you@example.com or username"
              className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-sm px-3 pr-10 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 border border-primary/30 text-primary text-sm font-semibold hover:border-primary/60 transition-colors rounded-sm disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          No account?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            Create one
          </Link>
        </p>
        <p className="text-center mt-4">
          <Link href="/" className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            ← Back to archive
          </Link>
        </p>
      </div>
    </div>
  );
}
