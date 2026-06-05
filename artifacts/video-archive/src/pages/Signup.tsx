import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Film, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Signup() {
  const { signUp } = useAuth();
  const [, setLocation] = useLocation();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setError(null);
    setLoading(true);
    const result = await signUp(email, password, displayName);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else if (result.needsVerification) {
      setNeedsVerification(true);
    } else {
      setLocation("/");
    }
  };

  if (needsVerification) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-6" />
          <h1 className="text-2xl font-black tracking-tight mb-2">Check your email</h1>
          <p className="text-sm text-muted-foreground mb-6">
            We sent a verification link to <strong className="text-foreground">{email}</strong>.
            Click it to activate your account.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 h-10 px-5 bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors rounded-sm"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-1.5 group mb-8">
            <Film className="w-5 h-5 text-primary" />
            <span className="font-black text-xl tracking-tighter text-foreground group-hover:text-primary transition-colors">
              VAULT<span className="text-primary">.</span>
            </span>
          </Link>
          <h1 className="text-2xl font-black tracking-tight mt-4">Create account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Save videos, build collections, sync across devices
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
              Display Name <span className="text-muted-foreground/40 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              placeholder="How others see you"
              maxLength={60}
              className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
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
                placeholder="At least 6 characters"
                className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 pr-10 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors rounded-sm disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
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
