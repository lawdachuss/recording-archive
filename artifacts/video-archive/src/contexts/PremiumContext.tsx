import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { premiumApi, type PremiumConfig, type PremiumStatus } from "@/lib/premium-client";
import { isAgeGatePassed, onAgeGatePassed } from "@/lib/gating";

/** Routes that never mount ad slots (auth + payment + admin screens). */
function isExcludedPage(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/premium") ||
    pathname.startsWith("/admin")
  );
}

interface PremiumContextValue {
  /** Runtime server config (kill-switch, earn target, grace, price). */
  config: PremiumConfig | undefined;
  /** Earn/premium state for the signed-in user; null when logged out. */
  status: PremiumStatus | null | undefined;
  loading: boolean;
  isPremium: boolean;
  canEarn: boolean;
  checkoutConfigured: boolean;
  agePassed: boolean;
  /** Once-per-device ad-free grace window (set when the age gate first passes). */
  inGrace: boolean;
  graceRemainingMs: number;
  /** Final gating predicate: should ads render on this page for this user? */
  showAds: boolean;
  excludedPage: boolean;
  refreshStatus: () => Promise<void>;
}

const PremiumContext = createContext<PremiumContextValue | null>(null);

const STATUS_QUERY_KEY = ["premium", "status"] as const;

export function PremiumProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [location] = useLocation();

  const [agePassed, setAgePassed] = useState(isAgeGatePassed);

  // Same-tab signal from the age gate (existing tag reads on mount).
  useEffect(() => {
    const unsub = onAgeGatePassed(() => {
      setAgePassed(true);
    });
    return unsub;
  }, []);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["premium", "config"],
    queryFn: premiumApi.getConfig,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: premiumApi.getStatus,
    enabled: !!user && agePassed,
    staleTime: 60_000,
    retry: 1,
  });

  const refreshStatus = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
  }, [queryClient]);

  const value = useMemo<PremiumContextValue>(() => {
    const isPremium = status?.is_premium === true && !premiumExpired(status);
    // Grace period disabled - ads show immediately after age gate
    const inGrace = false;

    const excludedPage = isExcludedPage(location);
    // Master switch VITE_ADS_ENABLED: unset/empty means ON (Vercel ships the
    // key empty today, and it previously had no effect at all); "false"/"0"/
    // "no" turns every ad slot off at once.
    const adsFlag = (import.meta.env.VITE_ADS_ENABLED ?? "").trim().toLowerCase();
    const adsEnabled = adsFlag !== "false" && adsFlag !== "0" && adsFlag !== "no";
    // Ads render when the switch is on, the age gate has passed, the user is
    // not premium and the route is not excluded.
    const showAds = adsEnabled && agePassed && !excludedPage && !isPremium;

    return {
      config,
      status,
      loading: configLoading || statusLoading,
      isPremium,
      canEarn: !!user && !isPremium,
      checkoutConfigured: config?.checkout_configured === true,
      agePassed,
      inGrace,
      graceRemainingMs: 0,
      showAds,
      excludedPage,
      refreshStatus,
    };
  }, [
    config,
    status,
    configLoading,
    statusLoading,
    user,
    agePassed,
    location,
    refreshStatus,
  ]);

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

function premiumExpired(status: PremiumStatus | null | undefined): boolean {
  const until = status?.premium_until;
  if (!until) return false;
  const t = new Date(until).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

export function usePremium(): PremiumContextValue {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used within PremiumProvider");
  return ctx;
}