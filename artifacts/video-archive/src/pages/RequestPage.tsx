import { useState } from "react";
import { useCreateRequest } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Send, CheckCircle2, AlertTriangle, Globe } from "lucide-react";

type Step = "site" | "username";

const SITES = [
  { id: "chaturbate", label: "Chaturbate", initials: "CB" },
  { id: "stripchat", label: "Stripchat", initials: "SC" },
] as const;

export default function RequestPage() {
  const [step, setStep] = useState<Step>("site");
  const [site, setSite] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRequest = useCreateRequest();

  const handleSiteSelect = (s: string) => {
    setSite(s);
    setStep("username");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Please enter a username.");
      return;
    }

    const streamLink = `https://${site}.com/${username.trim()}/`;

    createRequest.mutate(
      {
        data: {
          performer_username: username.trim(),
          stream_link: streamLink,
          notes: `Requested from ${site}`,
        },
      },
      {
        onSuccess: () => setSubmitted(true),
        onError: () => setError("Failed to submit request. Please try again."),
      },
    );
  };

  const handleBack = () => {
    setStep("site");
    setSite(null);
    setUsername("");
    setError(null);
  };

  const handleReset = () => {
    setSubmitted(false);
    setStep("site");
    setSite(null);
    setUsername("");
    setError(null);
  };

  if (submitted) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 max-w-lg text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-black tracking-tighter mb-2">Request submitted</h1>
          <p className="text-sm text-muted-foreground mb-2">
            {site} — <span className="text-foreground font-semibold">{username}</span>
          </p>
          <p className="text-xs text-muted-foreground/60 mb-8">
            We'll try to archive their next broadcast.
          </p>
          <button
            onClick={handleReset}
            className="h-9 px-5 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-sm"
          >
            Submit another
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-lg">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <Send className="w-3.5 h-3.5 text-primary" />
            Requests
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">
            {step === "site" ? "Select Site" : "Enter Username"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {step === "site"
              ? "Choose the platform where the performer streams."
              : "Type the performer's exact username to request archiving."}
          </p>
        </div>

        {step === "site" ? (
          <div className="space-y-3">
            {SITES.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSiteSelect(s.id)}
                className="w-full flex items-center gap-4 p-4 border border-border/50 hover:border-border hover:bg-secondary/40 rounded-sm transition-all group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0 group-hover:bg-secondary/80 transition-colors">
                  <Globe className="w-4 h-4 text-muted-foreground/60" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold text-foreground">{s.label}</div>
                  <div className="text-xs text-muted-foreground/50">{s.initials}.com</div>
                </div>
                <div className="ml-auto text-xs text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors">
                  Select →
                </div>
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">
                  {site} username
                </label>
                <button
                  type="button"
                  onClick={handleBack}
                  className="text-xs text-muted-foreground/40 hover:text-foreground/70 transition-colors"
                >
                  Change site
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/40 pointer-events-none select-none">
                  {site}.com/
                </span>
                <input
                  type="text"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={100}
                  autoFocus
                  className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-sm pl-28 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground/30"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-sm text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={createRequest.isPending}
              className="w-full h-10 flex items-center justify-center gap-2 text-sm font-semibold border border-primary/30 text-primary hover:border-primary/60 disabled:opacity-60 disabled:cursor-not-allowed transition-colors rounded-sm"
            >
              {createRequest.isPending ? (
                <>
                  <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Submit Request
                </>
              )}
            </button>

            <p className="text-xs text-muted-foreground/40 text-center leading-relaxed">
              Requests are reviewed and captured manually. No SLA is guaranteed.
            </p>
          </form>
        )}
      </div>
    </Layout>
  );
}
