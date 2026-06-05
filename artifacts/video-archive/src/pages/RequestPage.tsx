import { useState } from "react";
import { useCreateRequest } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Send, CheckCircle2, User, Link2, FileText, AlertTriangle } from "lucide-react";

type Priority = "low" | "normal" | "high";

const PRIORITY_LABELS: Record<Priority, { label: string; color: string }> = {
  low: { label: "Low", color: "text-muted-foreground" },
  normal: { label: "Normal", color: "text-primary" },
  high: { label: "High — urgent", color: "text-orange-500" },
};

export default function RequestPage() {
  const [performerUsername, setPerformerUsername] = useState("");
  const [streamLink, setStreamLink] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRequest = useCreateRequest();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!performerUsername.trim() && !streamLink.trim()) {
      setError("Please provide a performer username or stream link.");
      return;
    }

    createRequest.mutate(
      {
        data: {
          performer_username: performerUsername.trim() || undefined,
          stream_link: streamLink.trim() || undefined,
          notes: notes.trim() || undefined,
          priority,
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

  const handleReset = () => {
    setSubmitted(false);
    setPerformerUsername("");
    setStreamLink("");
    setNotes("");
    setPriority("normal");
    setError(null);
  };

  if (submitted) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 max-w-lg text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-5" />
          <h1 className="text-xl font-black tracking-tighter mb-2">Request submitted!</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Your recording request has been received. We'll try to get it archived as soon as
            possible.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleReset}
              className="h-9 px-5 text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors rounded-sm"
            >
              Submit another
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
            <Send className="w-3.5 h-3.5 text-primary" />
            Requests
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter">Request a Recording</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Know a performer we haven't archived? Submit a request and we'll try to capture their
            next broadcast.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Performer username */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 uppercase tracking-wide">
              <User className="w-3 h-3" />
              Performer Username
            </label>
            <input
              type="text"
              placeholder="e.g. alice123"
              value={performerUsername}
              onChange={(e) => setPerformerUsername(e.target.value)}
              maxLength={100}
              className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
            />
            <p className="text-[11px] text-muted-foreground/60">
              Chaturbate username of the performer to archive
            </p>
          </div>

          {/* OR divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border/40" />
            <span className="text-[11px] text-muted-foreground/50 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-border/40" />
          </div>

          {/* Stream link */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 uppercase tracking-wide">
              <Link2 className="w-3 h-3" />
              Stream Link
            </label>
            <input
              type="url"
              placeholder="https://chaturbate.com/username/"
              value={streamLink}
              onChange={(e) => setStreamLink(e.target.value)}
              maxLength={500}
              className="w-full h-10 bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
            />
            <p className="text-[11px] text-muted-foreground/60">
              Direct link to the performer's page or a specific broadcast
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 uppercase tracking-wide">
              <FileText className="w-3 h-3" />
              Notes{" "}
              <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">
                (optional)
              </span>
            </label>
            <textarea
              placeholder="Any details — schedule, show type, reason for request..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full bg-secondary/40 border border-border/60 focus:border-primary/50 rounded-sm px-3 py-2.5 text-sm outline-none transition-all placeholder:text-muted-foreground/40 resize-none"
            />
            <p className="text-right text-[11px] text-muted-foreground/40">{notes.length}/500</p>
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground/80 uppercase tracking-wide block">
              Priority
            </label>
            <div className="flex gap-2">
              {(["low", "normal", "high"] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 h-9 text-xs font-medium rounded-sm border transition-all ${
                    priority === p
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  {PRIORITY_LABELS[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-sm text-xs text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={createRequest.isPending}
            className="w-full h-10 flex items-center justify-center gap-2 text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors rounded-sm"
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
      </div>
    </Layout>
  );
}
