import { useState, useRef, useCallback } from "react";
import Stepper, { Step } from "@/components/Stepper";
import { PerformerDetailsCard, PerformerLookupLoading, PerformerLookupNotFound, PerformerLookupError } from "@/components/PerformerDetailsCard";
import { usePerformerLookup, useCreateRequest, type PerformerLookupResult } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Film, Sparkles, CheckCircle, Check } from "lucide-react";

type Platform = "chaturbate" | "stripchat" | null;

interface RequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RequestDialog({ open, onOpenChange }: RequestDialogProps) {
  const { user } = useAuth();

  if (!user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <div className="text-center py-8">
            <p className="text-muted-foreground">Please sign in to submit a request.</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return <RequestDialogInner open={open} onOpenChange={onOpenChange} />;
}

function RequestDialogInner({ open, onOpenChange }: RequestDialogProps) {
  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<Platform>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [lookupUsername, setLookupUsername] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [submitted, setSubmitted] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const {
    data: lookupData,
    isFetching: lookupLoading,
    isError: lookupError,
    error: lookupErrorObj,
    refetch: lookupRefetch,
  } = usePerformerLookup(platform ?? "", lookupUsername);

  const createRequest = useCreateRequest();

  const handlePlatformSelect = (p: Platform) => {
    setPlatform(p);
    setStep(2);
  };

  const handleStepChange = (newStep: number) => {
    if (newStep === 3 && step === 2 && usernameInput.trim()) {
      setLookupUsername(usernameInput.trim().toLowerCase());
    }
    if (newStep === 2) {
      setLookupUsername("");
      setConfirmed(false);
    }
    setStep(newStep);
  };

  const handleRetryLookup = () => {
    lookupRefetch();
  };

  const handleSubmit = useCallback(async () => {
    if (!platform || !lookupUsername) return;

    try {
      const result = await createRequest.mutateAsync({
        platform,
        performer_username: lookupUsername,
        notes: notes.trim() || undefined,
        priority,
      });
      setSubmissionId(result.id);
      setSubmitted(true);
      toast({ title: "Success", description: "Request submitted successfully!" });
    } catch {
      toast({ title: "Error", description: "Failed to submit request. Please try again.", variant: "destructive" });
    }
  }, [platform, lookupUsername, notes, priority, createRequest]);

  const resetForm = () => {
    setSubmitted(false);
    setStep(1);
    setPlatform(null);
    setUsernameInput("");
    setLookupUsername("");
    setConfirmed(false);
    setNotes("");
    setPriority("normal");
    setSubmissionId(null);
  };

  const canNext =
    step === 2 ? usernameInput.trim().length >= 2 :
    step === 3 ? (!!lookupData?.exists && confirmed && !lookupLoading) :
    step === 4 ? (!!platform && !!lookupUsername && !createRequest.isPending) :
    true;

  const nextButtonText =
    step === 3 ? "Looks good" :
    step === 4 ? "Submit Request" :
    "Continue";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg !p-5 !pb-4">
        {submitted ? (
          <div className="text-center py-3">
            <div className="animate-fade-in-scale">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
            </div>
            <h2 className="text-base font-bold text-foreground mb-1">Request Submitted!</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Your request for{" "}
              <span className="font-semibold text-foreground">@{lookupUsername}</span> on{" "}
              <span className="font-semibold text-foreground capitalize">{platform}</span> has been submitted.
            </p>
            {submissionId && (
              <p className="text-[11px] text-muted-foreground/50 mb-4">
                Request ID: {submissionId}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => onOpenChange(false)}
                className="px-3 py-1.5 text-xs border border-border/60 text-muted-foreground hover:text-foreground rounded-sm transition-colors"
              >
                Close
              </button>
              <button
                onClick={resetForm}
                className="px-3 py-1.5 text-xs border border-primary/30 text-primary hover:border-primary/60 rounded-sm transition-colors"
              >
                Submit another
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center mb-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/8 border border-primary/20 text-[10px] text-primary mb-2">
                <Sparkles className="w-2.5 h-2.5" />
                Request a performer
              </div>
              <h2 className="text-base font-black tracking-tight text-foreground">
                Request Recording
              </h2>
            </div>

            <Stepper
              initialStep={step}
              onStepChange={handleStepChange}
              onFinalStepCompleted={handleSubmit}
              backButtonText="Back"
              nextButtonText={nextButtonText}
              canNext={canNext}
              hideNext={step === 1}
              className="space-y-4"
            >
              <Step>
                <Step1PlatformSelect onSelect={handlePlatformSelect} />
              </Step>
              <Step>
                <Step2UsernameInput
                  value={usernameInput}
                  onChange={setUsernameInput}
                />
              </Step>
              <Step>
                <Step3Confirmation
                  lookupUsername={lookupUsername}
                  lookupData={lookupData ?? null}
                  lookupLoading={lookupLoading}
                  lookupError={lookupError}
                  lookupErrorMessage={lookupErrorObj instanceof Error ? lookupErrorObj.message : "Lookup failed"}
                  onRetryLookup={handleRetryLookup}
                  confirmed={confirmed}
                  onConfirmedChange={setConfirmed}
                />
              </Step>
              <Step>
                <Step4Submit
                  platform={platform}
                  lookupUsername={lookupUsername}
                  lookupData={lookupData ?? null}
                  notes={notes}
                  onNotesChange={setNotes}
                  priority={priority}
                  onPriorityChange={setPriority}
                  isSubmitting={createRequest.isPending}
                />
              </Step>
            </Stepper>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Step1PlatformSelect({ onSelect }: { onSelect: (p: Platform) => void }) {
  const platforms = [
    { id: "chaturbate" as const, name: "Chaturbate", desc: "Most popular cam site", color: "emerald", icon: Film },
    { id: "stripchat" as const, name: "Stripchat", desc: "Newer, fast-growing platform", color: "violet", icon: Sparkles },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground text-center">
        Select which platform the performer streams on
      </p>
      <div className="grid grid-cols-2 gap-3">
        {platforms.map(({ id, name, desc, color, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="group relative flex flex-col items-center gap-2 p-4 rounded-xl border border-border/40 bg-card hover:border-transparent transition-all duration-200 overflow-hidden"
          >
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background: `linear-gradient(135deg, ${color === "emerald" ? "rgba(16,185,129,0.08)" : "rgba(139,92,246,0.08)"}, transparent 60%)`,
              }}
            />
            <div className="absolute -inset-[1px] rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
              style={{
                background: color === "emerald"
                  ? "linear-gradient(135deg, rgba(16,185,129,0.3), transparent 50%, rgba(16,185,129,0.1))"
                  : "linear-gradient(135deg, rgba(139,92,246,0.3), transparent 50%, rgba(139,92,246,0.1))",
                mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                maskComposite: "exclude",
                padding: "1px",
                borderRadius: "inherit",
              }}
            />
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors relative ${
              color === "emerald"
                ? "bg-emerald-500/10 group-hover:bg-emerald-500/20"
                : "bg-violet-500/10 group-hover:bg-violet-500/20"
            }`}>
              <Icon className={`w-4 h-4 ${
                color === "emerald" ? "text-emerald-400" : "text-violet-400"
              }`} />
            </div>
            <div className="text-center relative">
              <p className={`text-xs font-bold text-foreground transition-colors ${
                color === "emerald"
                  ? "group-hover:text-emerald-400"
                  : "group-hover:text-violet-400"
              }`}>
                {name}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step2UsernameInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground text-center">
        Type the performer's username exactly as it appears on their profile
      </p>
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Performer username
        </label>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. sexysusan"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            className="w-full h-9 bg-secondary/80 border border-border/60 focus:border-primary/50 rounded-sm px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40 pr-8"
          />
          {value && (
            <button
              onClick={() => onChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {!value && (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center mb-1.5">
            <Film className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Type a username then click Continue to check
          </p>
        </div>
      )}
    </div>
  );
}

interface Step3ConfirmationProps {
  lookupUsername: string;
  lookupData: PerformerLookupResult | null;
  lookupLoading: boolean;
  lookupError: boolean;
  lookupErrorMessage: string;
  onRetryLookup: () => void;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
}

function Step3Confirmation({
  lookupUsername,
  lookupData,
  lookupLoading,
  lookupError: hasError,
  lookupErrorMessage,
  onRetryLookup,
  confirmed,
  onConfirmedChange,
}: Step3ConfirmationProps) {
  if (!lookupUsername) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-xs text-muted-foreground">No performer to look up. Go back and enter a username.</p>
      </div>
    );
  }

  if (lookupLoading) {
    return <PerformerLookupLoading platform={lookupData?.platform ?? ""} username={lookupUsername} />;
  }

  if (hasError) {
    return <PerformerLookupError message={lookupErrorMessage} onRetry={onRetryLookup} />;
  }

  if (!lookupData) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-xs text-muted-foreground">Waiting for lookup results...</p>
      </div>
    );
  }

  if (!lookupData.exists) {
    return (
      <div className="space-y-3">
        <PerformerLookupNotFound
          platform={lookupData.platform}
          username={lookupUsername}
          onRetry={() => {}} // handled by Stepper back button
        />
        <p className="text-center text-[11px] text-muted-foreground">
          Click <span className="text-primary">Back</span> to try a different username
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PerformerDetailsCard data={lookupData} />

      <label className="flex items-center gap-2.5 p-3 rounded-lg border border-border/30 bg-secondary/20 cursor-pointer hover:bg-secondary/30 transition-colors select-none">
        <button
          type="button"
          role="checkbox"
          aria-checked={confirmed}
          onClick={() => onConfirmedChange(!confirmed)}
          className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
            confirmed
              ? "bg-primary border-primary text-primary-foreground"
              : "border-border/60 bg-secondary"
          }`}
        >
          {confirmed && <Check className="w-3 h-3" />}
        </button>
        <span className="text-[11px] text-foreground leading-tight">
          I confirm this is the performer I want recorded
        </span>
      </label>
    </div>
  );
}

interface Step4SubmitProps {
  platform: Platform;
  lookupUsername: string;
  lookupData: PerformerLookupResult | null;
  notes: string;
  onNotesChange: (v: string) => void;
  priority: "low" | "normal" | "high";
  onPriorityChange: (v: "low" | "normal" | "high") => void;
  isSubmitting: boolean;
}

function Step4Submit({
  platform,
  lookupUsername,
  lookupData,
  notes,
  onNotesChange,
  priority,
  onPriorityChange,
  isSubmitting,
}: Step4SubmitProps) {
  return (
    <div className="space-y-3">
      {lookupData && (
        <PerformerDetailsCard data={lookupData} />
      )}

      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Notes <span className="text-muted-foreground/40 normal-case">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Any specific details about this request..."
          rows={2}
          className="w-full bg-secondary border border-border/60 focus:border-primary/50 rounded-sm px-3 py-1.5 text-sm outline-none transition-all placeholder:text-muted-foreground/40 resize-none"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Priority
        </label>
        <div className="flex gap-2">
          {(["low", "normal", "high"] as const).map((p) => (
            <button
              key={p}
              onClick={() => onPriorityChange(p)}
              className={`flex-1 h-7 text-[11px] font-medium rounded-sm border transition-colors ${
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
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Submitting...
        </div>
      )}
    </div>
  );
}