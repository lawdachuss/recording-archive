import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import Stepper, { Step } from "@/components/Stepper";
import { PerformerDetailsCard, PerformerLookupLoading, PerformerLookupNotFound, PerformerLookupError } from "@/components/PerformerDetailsCard";
import { usePerformerLookup, useCreateRequest, type PerformerLookupResult } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Layout } from "@/components/Layout";
import { toast } from "@/hooks/use-toast";
import { Film, Sparkles, CheckCircle } from "lucide-react";

type Platform = "chaturbate" | "stripchat" | null;

export default function RequestPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<Platform>(null);
  const [username, setUsername] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [submitted, setSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const {
    data: lookupData,
    isFetching: lookupLoading,
    isError: lookupError,
    error: lookupErrorObj,
    refetch: refetchLookup,
  } = usePerformerLookup(platform ?? "", debouncedUsername);

  const createRequest = useCreateRequest();

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (username.trim().length >= 2) {
      debounceTimer.current = setTimeout(() => {
        setDebouncedUsername(username.trim().toLowerCase());
      }, 600);
    } else {
      setDebouncedUsername("");
    }
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [username]);

  const handlePlatformSelect = (p: Platform) => {
    setPlatform(p);
    setStep(2);
  };

  const handleRetry = () => {
    setUsername("");
    setDebouncedUsername("");
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!platform || !username) return;

    try {
      const result = await createRequest.mutateAsync({
        platform,
        performer_username: username.trim().toLowerCase(),
        notes: notes.trim() || undefined,
        priority,
      });
      setSubmissionId(result.id);
      setSubmitted(true);
      toast({ title: "Success", description: "Request submitted successfully!" });
    } catch {
      toast({ title: "Error", description: "Failed to submit request. Please try again.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (step === 1) {
      setDebouncedUsername("");
      setUsername("");
    }
  }, [step]);

  const canSubmit = !!username && !!platform && !createRequest.isPending;

  if (!user) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-muted-foreground">Please sign in to submit a request.</p>
        </div>
      </Layout>
    );
  }

  if (submitted) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center px-4">
          <div className="w-full max-w-md text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", duration: 0.6 }}
            >
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-6" />
            </motion.div>
            <h2 className="text-xl font-bold text-foreground mb-2">Request Submitted!</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Your request for{" "}
              <span className="font-semibold text-foreground">@{username}</span> on{" "}
              <span className="font-semibold text-foreground capitalize">{platform}</span> has been submitted.
            </p>
            {submissionId && (
              <p className="text-xs text-muted-foreground/50 mb-8">
                Request ID: {submissionId}
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setLocation("/")}
                className="px-4 py-2 text-xs border border-border/60 text-muted-foreground hover:text-foreground rounded-sm transition-colors"
              >
                Back to archive
              </button>
              <button
                onClick={() => {
                  setSubmitted(false);
                  setStep(1);
                  setPlatform(null);
                  setUsername("");
                  setDebouncedUsername("");
                  setNotes("");
                  setPriority("normal");
                  setSubmissionId(null);
                }}
                className="px-4 py-2 text-xs border border-primary/30 text-primary hover:border-primary/60 rounded-sm transition-colors"
              >
                Submit another
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 text-xs text-primary mb-4">
              <Sparkles className="w-3 h-3" />
              Request a performer
            </div>
            <h1 className="text-2xl font-black tracking-tight text-foreground">
              Request Recording
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Request a performer from Chaturbate or Stripchat
            </p>
          </div>

          <Stepper
            initialStep={step}
            onStepChange={(s) => setStep(s)}
            onFinalStepCompleted={handleSubmit}
            backButtonText="Back"
            nextButtonText={step === 3 ? "Submit Request" : "Continue"}
          >
            <Step>
              <Step1PlatformSelect onSelect={handlePlatformSelect} />
            </Step>
            <Step>
              <Step2PerformerLookup
                platform={platform}
                username={username}
                onUsernameChange={setUsername}
                lookupData={lookupData ?? null}
                lookupLoading={lookupLoading}
                lookupError={lookupError}
                lookupErrorMessage={lookupErrorObj instanceof Error ? lookupErrorObj.message : "Lookup failed"}
                onRetry={handleRetry}
              />
            </Step>
            <Step>
              <Step3Confirm
                platform={platform}
                username={username}
                lookupData={lookupData ?? null}
                notes={notes}
                onNotesChange={setNotes}
                priority={priority}
                onPriorityChange={setPriority}
                isSubmitting={createRequest.isPending}
              />
            </Step>
          </Stepper>
        </div>
      </div>
    </Layout>
  );
}

function Step1PlatformSelect({ onSelect }: { onSelect: (p: Platform) => void }) {
  return (
    <div className="space-y-4 py-4">
      <p className="text-xs text-muted-foreground text-center">
        Select which platform the performer streams on
      </p>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => onSelect("chaturbate")}
          className="group relative flex flex-col items-center gap-3 p-6 rounded-xl border border-border/40 bg-card hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all duration-200"
        >
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
            <Film className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-foreground group-hover:text-emerald-400 transition-colors">
              Chaturbate
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Most popular cam site
            </p>
          </div>
        </button>
        <button
          onClick={() => onSelect("stripchat")}
          className="group relative flex flex-col items-center gap-3 p-6 rounded-xl border border-border/40 bg-card hover:border-violet-500/40 hover:bg-violet-500/5 transition-all duration-200"
        >
          <div className="w-14 h-14 rounded-full bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-500/20 transition-colors">
            <Sparkles className="w-6 h-6 text-violet-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-foreground group-hover:text-violet-400 transition-colors">
              Stripchat
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Newer, fast-growing platform
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

interface Step2PerformerLookupProps {
  platform: Platform;
  username: string;
  onUsernameChange: (v: string) => void;
  lookupData: PerformerLookupResult | null;
  lookupLoading: boolean;
  lookupError: boolean;
  lookupErrorMessage: string;
  onRetry: () => void;
}

function Step2PerformerLookup({
  platform,
  username,
  onUsernameChange,
  lookupData,
  lookupLoading,
  lookupError: hasError,
  lookupErrorMessage,
  onRetry,
}: Step2PerformerLookupProps) {
  const data = lookupData;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Performer username on{" "}
          <span className="capitalize font-semibold text-foreground">{platform}</span>
        </label>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="e.g. sexysusan"
            className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
          />
          {username && (
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              Profile: {platform === "chaturbate" ? "chaturbate.com" : "stripchat.com"}/{username.toLowerCase()}
            </p>
          )}
        </div>
      </div>

      {username.trim().length >= 2 && (
        <div className="mt-4">
          {lookupLoading && (
            <PerformerLookupLoading platform={platform ?? ""} username={username} />
          )}
          {!lookupLoading && hasError && (
            <PerformerLookupError message={lookupErrorMessage} onRetry={onRetry} />
          )}
          {!lookupLoading && !hasError && data && (
            data.exists ? (
              <PerformerDetailsCard data={data} />
            ) : (
              <PerformerLookupNotFound
                platform={platform ?? ""}
                username={username}
                onRetry={onRetry}
              />
            )
          )}
        </div>
      )}

      {!username && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mb-3">
            <Film className="w-4 h-4 text-muted-foreground/40" />
          </div>
          <p className="text-xs text-muted-foreground">
            Type a username to check if the performer exists on {platform}
          </p>
        </div>
      )}
    </div>
  );
}

interface Step3ConfirmProps {
  platform: Platform;
  username: string;
  lookupData: PerformerLookupResult | null;
  notes: string;
  onNotesChange: (v: string) => void;
  priority: "low" | "normal" | "high";
  onPriorityChange: (v: "low" | "normal" | "high") => void;
  isSubmitting: boolean;
}

function Step3Confirm({
  platform,
  username,
  lookupData,
  notes,
  onNotesChange,
  priority,
  onPriorityChange,
  isSubmitting,
}: Step3ConfirmProps) {
  return (
    <div className="space-y-5 py-2">
      {lookupData && (
        <PerformerDetailsCard data={lookupData} />
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Any specific details about this request..."
          rows={3}
          className="w-full bg-secondary border border-border/60 focus:border-primary/50 rounded-sm px-3 py-2 text-sm outline-none transition-all placeholder:text-muted-foreground/40 resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Priority
        </label>
        <div className="flex gap-2">
          {(["low", "normal", "high"] as const).map((p) => (
            <button
              key={p}
              onClick={() => onPriorityChange(p)}
              className={`flex-1 h-9 text-xs font-medium rounded-sm border transition-colors ${
                priority === p
                  ? "border-primary/50 bg-primary/8 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isSubmitting && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Submitting...
        </div>
      )}
    </div>
  );
}
