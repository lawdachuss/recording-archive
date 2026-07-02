import { useState } from "react";
import { useCreateRequest } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Send, CheckCircle2, AlertTriangle } from "lucide-react";

type Step = "site" | "username";

const SITES = [
  { id: "chaturbate", label: "Chaturbate", color: "text-green-500", border: "border-green-500/40 hover:border-green-500/70" },
  { id: "stripchat", label: "Stripchat", color: "text-pink-500", border: "border-pink-500/40 hover:border-pink-500/70" },
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
        onSuccess: () => {
          setSubmitted(true);
        },
        onError: () => {
          setError("Failed to submit request. Please try again.");
        },
      },
    );
  };

  const handleBack = () => {
    setStep("site");
    setSite(null);
    setUsername("");
    setError(null);
  };

  if (submitted) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 max-w-lg text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-5" />
          <h1 className="text-xl font-black tracking-tighter mb-2">Request submitted!</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Your recording request for <span className="text-foreground font-semibold">{site}</span> performer{" "}
            <span className="text-foreground font-semibold">{username}</span> has been received.
          </p>
          <button
            onClick={() => { setSubmitted(false); setStep("site"); setSite(null); setUsername(""); }}
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
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <Send className="w-3.5 h-3.5 text-primary" />
            Requests
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Request a Recording</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {step === "site"
              ? "Select the site where the performer streams."
              : "Enter the performer's username to request archiving."}
          </p>
        </div>

        {step === "site" ? (
          <div className="grid grid-cols-2 gap-4">
            {SITES.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSiteSelect(s.id)}
                className={`flex flex-col items-center justify-center gap-3 h-40 border-2 rounded-sm bg-secondary/30 ${s.border} transition-all hover:bg-secondary/60 hover:scale-[1.02] active:scale-[0.98] cursor-pointer`}
              >
                <span className={`text-2xl font-black tracking-tighter ${s.color}`}>
                  {s.id === "chaturbate" ? "CB" : "SC"}
                </span>
                <span className="text-sm font-semibold text-foreground/80">{s.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 uppercase tracking-wide">
                  {site === "chaturbate" ? (
                    <span className="text-green-500">Chaturbate</span>
                  ) : (
                    <span className="text-pink-500">Stripchat</span>
                  )}
                  <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">username</span>
                </label>
                <button
                  type="button"
                  onClick={handleBack}
                  className="text-[11px] text-muted-foreground/50 hover:text-foreground transition-colors"
                >
                  Change site
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/50 pointer-events-none">
                  {site}.com/
                </span>
                <input
                  type="text"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={100}
                  autoFocus
                  className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-sm pl-28 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
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
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Submit Request
                </>
              )}
            </button>

            <p className="text-[11px] text-muted-foreground/50 text-center leading-relaxed">
              Requests are reviewed and captured manually. No SLA is guaranteed.
            </p>
          </form>
        )}
      </div>
    </Layout>
  );
}
