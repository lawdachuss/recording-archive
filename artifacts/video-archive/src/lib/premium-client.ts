/**
 * premium-client.ts — typed client for the /api/premium endpoints.
 *
 * Mirror of lib/user-api.ts: session token pulled from Supabase, requests
 * resolved through the shared API base, JSON errors surfaced as typed results
 * (no throw-on-HTTP so the UI can show cooldowns / not_configured states).
 */
import { getSupabase } from "./supabase";
import { resolveApiPath } from "./api-base";

async function authHeaders(): Promise<Record<string, string>> {
  const sb = await getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export interface PremiumConfig {
  ads_enabled: boolean;
  ads_target: number;
  reward_cooldown_s: number;
  grace_minutes: number;
  price_usd: number;
  checkout_configured: boolean;
}

export interface PremiumStatus {
  is_premium: boolean;
  premium_until: string | null;
  ads_viewed_today: number;
  ads_target: number;
  can_earn: boolean;
  cooldown_s: number;
  ads_enabled: boolean;
  grace_minutes: number;
}

export type RewardResult =
  | {
      ok: true;
      granted: boolean;
      cooldown_ms: number;
      ads_viewed_today: number;
      ads_target: number;
      premium_until: string | null;
      is_premium: boolean;
    }
  | { ok: false; error: string; cooldown_ms?: number };

export interface CheckoutResult {
  ok: boolean;
  checkoutUrl?: string;
  notConfigured?: boolean;
  error?: string;
}

async function getToken(): Promise<string | null> {
  const sb = await getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  return session?.access_token ?? null;
}

export const premiumApi = {
  /** Public runtime config (kill-switch, earn target, grace, price). */
  async getConfig(): Promise<PremiumConfig> {
    const res = await fetch(resolveApiPath("/api/premium/config"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /** Premium/earn status for the signed-in user. Requires a session. */
  async getStatus(): Promise<PremiumStatus | null> {
    const token = await getToken();
    if (!token) return null;
    const res = await fetch(resolveApiPath("/api/user/premium/status"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  },

  /** Claim a rewarded-ad view. Server enforces cooldown + daily target. */
  async claimReward(): Promise<RewardResult> {
    const token = await getToken();
    const payload: RewardResult = {
      ok: false,
      error: "not_authenticated",
    };
    if (!token) return payload;

    try {
      const res = await fetch(resolveApiPath("/api/user/premium/reward"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (res.status === 429 && json) {
        return {
          ok: false,
          error: "cooldown",
          cooldown_ms: typeof json.cooldown_ms === "number" ? json.cooldown_ms : 0,
        };
      }
      if (!res.ok || !json) {
        return { ok: false, error: String(json?.error ?? "server_error") };
      }
      return {
        ok: true,
        granted: json.granted === true,
        cooldown_ms: typeof json.cooldown_ms === "number" ? json.cooldown_ms : 0,
        ads_viewed_today: typeof json.ads_viewed_today === "number" ? json.ads_viewed_today : 0,
        ads_target: typeof json.ads_target === "number" ? json.ads_target : 5,
        premium_until: typeof json.premium_until === "string" ? json.premium_until : null,
        is_premium: json.is_premium === true,
      };
    } catch {
      return { ok: false, error: "network" };
    }
  },

  /** Open Stripe Checkout for a 1-month premium subscription. */
  async createCheckout(): Promise<CheckoutResult> {
    const token = await getToken();
    if (!token) return { ok: false, error: "not_authenticated" };
    try {
      const res = await fetch(resolveApiPath("/api/user/premium/checkout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as {
        provider?: string;
        checkoutUrl?: string;
        error?: string;
      } | null;
      if (res.ok && json?.checkoutUrl) {
        return { ok: true, checkoutUrl: json.checkoutUrl };
      }
      if (res.status === 501) return { ok: false, notConfigured: true, error: json?.error ?? "not_configured" };
      return { ok: false, error: json?.error ?? "server_error" };
    } catch {
      return { ok: false, error: "network" };
    }
  },
};