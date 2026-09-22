import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  CheckCircle2,
  Loader2,
  Crown,
  AlertTriangle,
  Sparkles,
  Gift,
  ExternalLink,
  Timer,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePremium } from "@/contexts/PremiumContext";
import { premiumApi } from "@/lib/premium-client";
import { adsterraSmartlinkUrl } from "@/lib/ads";

export default function Premium() {
  const { user, loading } = useAuth();
  const { config, status, isPremium, refreshStatus } = usePremium();
  const search = useSearch();
  const paid = new URLSearchParams(search).get("paid") === "1";

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const price = config?.price_usd ?? 4.99;
  const adsTarget = status?.ads_target ?? config?.ads_target ?? 5;
  const adsViewed = status?.ads_viewed_today ?? 0;

  // Sync initial cooldown from status if present
  useEffect(() => {
    if (status?.cooldown_s && status.cooldown_s > 0) {
      setCooldownSeconds(status.cooldown_s);
    }
  }, [status?.cooldown_s]);

  // Tick down cooldown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // Refresh premium status once on mount (Catches an already-active
  // subscription) and whenever the user lands back here after checkout.
  useEffect(() => {
    if (isPremium || paid) void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paid) void refreshStatus();
  }, [paid, refreshStatus]);

  const handleClaimReward = async () => {
    if (claiming || cooldownSeconds > 0) return;
    setClaiming(true);
    setClaimMsg(null);

    // Open the high-CPM Adsterra Smartlink in a new tab
    const smartlink = adsterraSmartlinkUrl();
    window.open(smartlink, "_blank", "noopener,noreferrer");

    try {
      const res = await premiumApi.claimReward();
      if (res.ok) {
        await refreshStatus();
        if (res.granted) {
          setClaimMsg({
            ok: true,
            text: "🎉 Congratulations! Target reached — 24 hours of ad-free Premium unlocked!",
          });
        } else {
          setClaimMsg({
            ok: true,
            text: `Ad view verified! (${res.ads_viewed_today}/${res.ads_target} completed for today)`,
          });
        }
        if (res.cooldown_ms > 0) {
          setCooldownSeconds(Math.ceil(res.cooldown_ms / 1000));
        }
      } else {
        if (res.error === "cooldown" && res.cooldown_ms) {
          const s = Math.ceil(res.cooldown_ms / 1000);
          setCooldownSeconds(s);
          setClaimMsg({ ok: false, text: `Please wait ${s}s before watching the next ad.` });
        } else {
          setClaimMsg({
            ok: false,
            text: res.error === "not_authenticated" ? "Sign in to earn rewards." : "Could not verify reward. Please try again.",
          });
        }
      }
    } catch {
      setClaimMsg({ ok: false, text: "Network error while claiming reward." });
    } finally {
      setClaiming(false);
    }
  };

  const handleCheckout = async () => {
    setCheckingOut(true);
    setCheckoutError(null);
    try {
      const res = await premiumApi.createCheckout();
      if (res.ok && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      setCheckoutError(
        res.notConfigured
          ? "Payments aren't available yet — ask an admin to enable them."
          : res.error === "not_authenticated"
            ? "Sign in to purchase premium."
            : "Something went wrong. Try again.",
      );
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto max-w-2xl px-4 sm:px-6 py-14">
        {paid && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Payment received — premium is active. Enjoy ad-free viewing!
          </div>
        )}

        <div className="text-center mb-10">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Crown className="w-5 h-5 text-primary" />
            <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground font-medium">
              VAULT Premium
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-3">
            Watch ad-free, <span className="text-primary">forever clear</span>
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            No banners, no interruptions — plus you can earn premium days free
            by watching a few sponsored ads.
          </p>
        </div>

        {loading ? null : !user ? (
          <div className="rounded-xl border border-border/40 bg-card/40 p-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Premium is tied to your account so your ad-free status follows you
              on every device.
            </p>
            <div className="flex gap-3 justify-center">
              <Link to="/login">
                <Button>Sign in</Button>
              </Link>
              <Link to="/signup">
                <Button variant="outline">Create account</Button>
              </Link>
            </div>
          </div>
        ) : isPremium ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-8 text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto" />
            <p className="text-sm font-semibold">You're covered.</p>
            <p className="text-xs text-muted-foreground">
              {status?.premium_until
                ? `Premium active until ${formatDate(status.premium_until)}`
                : "Premium active."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Buy */}
            <div className="rounded-xl border border-border/40 bg-card/40 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold tracking-tight">Buy premium</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">30 days ad-free</p>
                </div>
                <Badge variant="default">${price.toFixed(2)}</Badge>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground mb-5">
                <li className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" /> No ads on any page
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" /> Stacks — extend before it lapses
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" /> Syncs across devices
                </li>
              </ul>
              <Button onClick={handleCheckout} disabled={checkingOut} className="w-full">
                {checkingOut ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Preparing checkout…
                  </>
                ) : (
                  <>Buy premium — ${price.toFixed(2)}</>
                )}
              </Button>
              {checkoutError && (
                <p className="mt-3 text-xs text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {checkoutError}
                </p>
              )}
            </div>

            {/* Earn Free */}
            <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-6 relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-bold tracking-tight">Earn premium free</h2>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Watch {adsTarget} sponsored ads to unlock 24h ad-free access
                  </p>
                </div>
                <Badge variant="outline" className="border-primary/40 text-primary font-semibold">
                  100% Free
                </Badge>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5 mb-5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Today's progress</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {adsViewed} / {adsTarget} ads
                  </span>
                </div>
                <div className="h-2 w-full bg-secondary/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${Math.min(100, Math.round((adsViewed / adsTarget) * 100))}%` }}
                  />
                </div>
              </div>

              <Button
                onClick={handleClaimReward}
                disabled={claiming || cooldownSeconds > 0}
                variant="outline"
                className="w-full border-primary/40 hover:bg-primary/10 hover:border-primary transition-all"
              >
                {claiming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Verifying ad view…
                  </>
                ) : cooldownSeconds > 0 ? (
                  <>
                    <Timer className="w-4 h-4" /> Next ad in {cooldownSeconds}s
                  </>
                ) : (
                  <>
                    <Gift className="w-4 h-4 text-primary" /> Watch Sponsored Ad (+1 Progress)
                  </>
                )}
              </Button>

              {claimMsg && (
                <p
                  className={`mt-3 text-xs flex items-center gap-1.5 ${
                    claimMsg.ok ? "text-green-500 font-medium" : "text-destructive"
                  }`}
                >
                  {claimMsg.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  {claimMsg.text}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}