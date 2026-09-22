import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { getSupabase } from "@/lib/supabase";

const ERROR_HINTS: [RegExp, string][] = [
  [/expired/i, "This link has expired. Please request a new one."],
  [/already been used/i, "This link was already used. Please request a new one."],
  [/invalid/i, "This link isn't valid. Please request a new one."],
  [/not found/i, "This link isn't valid. Please request a new one."],
];

function errorHint(message: string): string {
  for (const [re, hint] of ERROR_HINTS) {
    if (re.test(message)) return hint;
  }
  return message;
}

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  // Fallback so a broken link can never leave the user on "Verifying…" forever.
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const query = window.location.search.substring(1);
    const params = new URLSearchParams(hash || query);

    const errorParam =
      params.get("error_description") ||
      params.get("error") ||
      params.get("error_code") ||
      params.get("error_message");
    if (errorParam) {
      setError(errorHint(errorParam));
      return;
    }

    let unsub: (() => void) | null = null;
    let done = false;

    const finish = (path: string) => {
      if (done) return;
      done = true;
      unsub?.();
      setLocation(path);
    };

    const timeout = window.setTimeout(() => {
      if (done) return;
      done = true;
      unsub?.();
      setError(
        "We couldn't complete the sign-in. The link may be stale — try again or request a new one.",
      );
      setTimedOut(true);
    }, 12_000);

    getSupabase()
      .then((sb) => {
        // The recovery/verification event can fire during getSession() on a
        // cold start (before the subscription below attaches), so inspect the
        // current session too.
        void sb.auth.getSession().then(({ data: { session } }) => {
          if (done) return;
          if (session) {
            // Supabase marks recovery links with `type=recovery` in the URL.
            finish(params.get("type") === "recovery" ? "/settings" : "/");
          }
        });

        const {
          data: { subscription },
        } = sb.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY") {
            finish("/settings");
          } else if (event === "SIGNED_IN") {
            finish("/");
          } else if (event === "INITIAL_SESSION") {
            // No-op; getSession() above already handled it.
          } else if (event === "SIGNED_OUT") {
            finish("/login");
          }
        });
        unsub = () => subscription.unsubscribe();
      })
      .catch(() => {
        finish("/login");
      });

    return () => {
      window.clearTimeout(timeout);
      unsub?.();
    };
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-sm text-destructive mb-2">{error}</p>
            <button
              onClick={() => setLocation("/login")}
              className="text-xs text-primary/80 hover:text-primary underline underline-offset-2"
            >
              {timedOut ? "Go to login" : "Back to login"}
            </button>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Verifying…</p>
          </>
        )}
      </div>
    </div>
  );
}