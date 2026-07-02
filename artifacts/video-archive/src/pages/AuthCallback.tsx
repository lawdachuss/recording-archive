import { useEffect } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setLocation("/settings");
      } else if (event === "SIGNED_IN") {
        setLocation("/");
      } else {
        setLocation("/login");
      }
    });
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="bg-cross-dots fixed inset-0 pointer-events-none opacity-[0.10] dark:opacity-[0.06]" />
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Verifying…</p>
      </div>
    </div>
  );
}
