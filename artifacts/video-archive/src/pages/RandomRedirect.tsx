import { useEffect } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { Loader2 } from "lucide-react";

export default function RandomRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    async function fetchRandom() {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const res = await fetch(`${base}/api/recordings/random`);
        if (res.ok) {
          const data = await res.json();
          if (data?.id) {
            setLocation(`/video/${data.id}`);
            return;
          }
        }
      } catch {
        // fallback below
      }
      setLocation("/browse");
    }
    fetchRandom();
  }, [setLocation]);

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-primary/40 animate-spin" />
        <p className="text-sm text-muted-foreground">Finding a random recording…</p>
      </div>
    </Layout>
  );
}
