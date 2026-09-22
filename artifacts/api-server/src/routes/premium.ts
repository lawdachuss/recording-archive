import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { authenticatedRateLimit } from "../middleware/rate-limit.js";

const router = Router();
const admin = requireRole("admin");

// ─── Runtime settings (site_settings overrides, no redeploy for the switch) ─

interface PremiumSettings {
  ads_enabled: boolean;
  ads_target: number;
  reward_cooldown_s: number;
  grace_minutes: number;
  price_usd: number;
}

const DEFAULT_SETTINGS: PremiumSettings = {
  ads_enabled: true,
  ads_target: 5,
  reward_cooldown_s: 60,
  grace_minutes: 10,
  price_usd: 4.99,
};

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function asInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : fallback;
}
function asNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

async function getSettings(): Promise<PremiumSettings> {
  try {
    const { data } = await supabase.from("site_settings").select("key,value");
    const map = new Map<string, unknown>((data ?? []).map((r) => [r.key, r.value]));
    return {
      ads_enabled: asBool(map.get("ads_enabled"), DEFAULT_SETTINGS.ads_enabled),
      ads_target: asInt(map.get("ads_target"), DEFAULT_SETTINGS.ads_target),
      reward_cooldown_s: asInt(map.get("reward_cooldown_s"), DEFAULT_SETTINGS.reward_cooldown_s),
      grace_minutes: asInt(map.get("grace_minutes"), DEFAULT_SETTINGS.grace_minutes),
      price_usd: asNum(map.get("price_usd"), DEFAULT_SETTINGS.price_usd),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface RewardResponse {
  granted: boolean;
  cooldown_ms: number;
  already_granted_today: boolean;
  ads_viewed_today: number;
  ads_target: number;
  premium_until: string | null;
  is_premium: boolean;
}

function normalizeReward(raw: Record<string, unknown>): RewardResponse {
  return {
    granted: asBool(raw.granted, false),
    cooldown_ms: asInt(raw.cooldown_ms, 0),
    already_granted_today: asBool(raw.already_granted_today, false),
    ads_viewed_today: asInt(raw.ads_viewed_today, 0),
    ads_target: asInt(raw.ads_target, DEFAULT_SETTINGS.ads_target),
    premium_until: typeof raw.premium_until === "string" ? raw.premium_until : null,
    is_premium: asBool(raw.is_premium, false),
  };
}

function isPremiumRow(premiumUntil: unknown): boolean {
  if (typeof premiumUntil !== "string") return false;
  const t = new Date(premiumUntil).getTime();
  return Number.isFinite(t) && t > Date.now();
}

// ─── Public: config (non-sensitive) ─────────────────────────────────────────
// Used by the frontend for the grace timer, earn progress UI and kill-switch.
// Never includes user data.

router.get("/premium/config", async (_req: Request, res: Response) => {
  const s = await getSettings();
  res.json({
    ads_enabled: s.ads_enabled,
    ads_target: s.ads_target,
    reward_cooldown_s: s.reward_cooldown_s,
    grace_minutes: s.grace_minutes,
    price_usd: s.price_usd,
    checkout_configured: isStripeConfigured(),
  });
});

// ─── User: premium status ──────────────────────────────────────────────────

router.get("/user/premium/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const [s, row] = await Promise.all([
      getSettings(),
      supabase.from("user_premium").select("premium_expires_at,ads_seen_date,ads_seen_count,last_granted_date").eq("user_id", userId).maybeSingle(),
    ]);

    const premiumUntil = row.data?.premium_expires_at ?? null;
    const isPremium = isPremiumRow(premiumUntil);

    // Only count today's ads (roll stale daily counters client-side).
    const today = new Date().toISOString().slice(0, 10);
    const adsViewedToday = row.data && row.data.ads_seen_date === today ? row.data.ads_seen_count ?? 0 : 0;
    const rewardGrantedToday = row.data?.last_granted_date === today;

    res.json({
      is_premium: isPremium,
      premium_until: premiumUntil,
      ads_viewed_today: adsViewedToday,
      reward_granted_today: rewardGrantedToday,
      ads_target: s.ads_target,
      can_earn: !isPremium,
      cooldown_s: s.reward_cooldown_s,
      ads_enabled: s.ads_enabled,
      grace_minutes: s.grace_minutes,
    });
  } catch (err) {
    req.log?.error?.({ err }, "GET /user/premium/status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── User: claim a rewarded ad view (5/day -> +1 day premium) ─────────────
// Server-authoritative: the atomic claim_premium_reward() SQL function enforces
// the daily target, the per-user cooldown, date roll and expiry extension.

router.post(
  "/user/premium/reward",
  requireAuth,
  authenticatedRateLimit(),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;

    let s: PremiumSettings;
    try {
      s = await getSettings();
    } catch (err) {
      req.log?.error?.({ err }, "POST /user/premium/reward settings error");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!s.ads_enabled) {
      res.status(403).json({ error: "Ads are currently disabled", cooldown_ms: 0 });
      return;
    }

    const { data, error } = await supabase.rpc("claim_premium_reward", {
      p_user_id: userId,
      p_cooldown_s: s.reward_cooldown_s,
      p_target: s.ads_target,
    });

    if (error) {
      req.log?.error?.({ err: error }, "POST /user/premium/reward rpc error");
      res.status(500).json({ error: "Premium service unavailable" });
      return;
    }

    const result = normalizeReward((data ?? {}) as Record<string, unknown>);
    if (result.cooldown_ms > 0) {
      res.status(429).json(result);
      return;
    }
    res.json(result);
  },
);

// ─── User: buy premium (1 month) via Stripe Checkout ──────────────────────
// Returns a generic { provider, checkoutUrl }; provider is swappable via env.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

function isStripeConfigured(): boolean {
  // Full pipeline required: without the webhook secret, paid customers would
  // never be granted premium (the webhook would 400), so treat it as not
  // configured rather than let checkout proceed into a dead end.
  return Boolean(STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET);
}

router.post("/user/premium/checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isStripeConfigured()) {
      res.status(501).json({ error: "not_configured", provider: "stripe" });
      return;
    }

    const userId = req.user!.id;
    const email = req.user!.email;
    const s = await getSettings();
    const priceUsd = s.price_usd;
    const amount = Math.max(50, Math.round(priceUsd * 100));

    // Never trust x-forwarded-host / Host when building user-visible redirect
    // URLs — a client can set those headers and turn Stripe's success/cancel
    // redirects into an open redirect off the payment flow. Use a fixed
    // canonical origin (env-overridable for preview deploys) instead.
    const publicOrigin = (process.env.PUBLIC_URL ?? "https://chuglii.in").trim().replace(/\/+$/, "");
    const origin = /^https?:\/\//i.test(publicOrigin) ? publicOrigin : "https://chuglii.in";

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("client_reference_id", userId);
    if (email) params.set("customer_email", email);
    params.set("success_url", `${origin}/premium?paid=1`);
    params.set("cancel_url", `${origin}/premium`);
    params.set("metadata[days]", "30");
    if (STRIPE_PRICE_ID) {
      params.set("line_items[0][price]", STRIPE_PRICE_ID);
    } else {
      params.set("line_items[0][price_data][currency]", "usd");
      params.set("line_items[0][price_data][unit_amount]", String(amount));
      params.set("line_items[0][price_data][product_data][name]", "VAULT Premium — 1 month ad-free");
      params.set("line_items[0][price_data][product_data][metadata][purpose]", "premium");
    }
    params.set("line_items[0][quantity]", "1");

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const json = (await resp.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!resp.ok || !json?.url) {
      req.log?.error?.({ status: resp.status, stripe: json?.error?.message }, "Stripe checkout session failed");
      res.status(502).json({ error: "Payment provider failed" });
      return;
    }

    res.json({ provider: "stripe", checkoutUrl: json.url });
  } catch (err) {
    req.log?.error?.({ err }, "POST /user/premium/checkout error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Stripe webhook (no auth; signed) ─────────────────────────────────────
// Raw body is provided by an app-level express.raw() mount in app.ts so the
// signature can be verified against the exact bytes Stripe sent.

export function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const entries = signature.split(",").map((p) => p.trim());
  const t = entries.find((p) => p.startsWith("t="))?.slice(2);
  const v1 = entries.find((p) => p.startsWith("v1="))?.slice(3);
  if (!t || !v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(v1, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function daysFromMeta(days: unknown, fallback = 30): number {
  const n = parseInt(String(days ?? fallback), 10);
  return Number.isFinite(n) ? Math.min(90, Math.max(1, n)) : fallback;
}

async function handleCheckoutCompleted(session: Record<string, unknown>): Promise<void> {
  const sessionId = typeof session.id === "string" ? session.id : undefined;
  const userId = typeof session.client_reference_id === "string" ? session.client_reference_id : undefined;
  if (!sessionId || !userId) return;

  // Idempotency: a duplicate event (Stripe retries) must not double-grant.
  const { data: existing } = await supabase
    .from("premium_purchases")
    .select("id")
    .eq("provider_session_id", sessionId)
    .maybeSingle();
  if (existing) return;

  const days = daysFromMeta((session.metadata as { days?: string } | undefined)?.days);

  const { error: insertError } = await supabase.from("premium_purchases").insert({
    user_id: userId,
    provider: "stripe",
    provider_session_id: sessionId,
    amount: typeof session.amount_total === "number" ? session.amount_total / 100 : null,
    currency: typeof session.currency === "string" ? session.currency : "usd",
    days,
  });
  if (insertError) throw insertError;

  const { data: prev, error: prevError } = await supabase
    .from("user_premium")
    .select("premium_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (prevError) throw prevError;

  const base = prev?.premium_expires_at ? new Date(prev.premium_expires_at).getTime() : Date.now();
  const expires = new Date(Math.max(Date.now(), base) + days * 86_400_000).toISOString();

  const { error: upsertError } = await supabase.from("user_premium").upsert(
    { user_id: userId, premium_expires_at: expires, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (upsertError) throw upsertError;
}

router.post("/premium/webhook", async (req: Request, res: Response) => {
  if (!STRIPE_WEBHOOK_SECRET) {
    res.status(400).json({ error: "webhook_secret_not_configured" });
    return;
  }
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    res.status(400).json({ error: "missing_signature" });
    return;
  }
  const payload = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
  if (!verifyStripeSignature(payload, sig, STRIPE_WEBHOOK_SECRET)) {
    res.status(400).json({ error: "invalid_signature" });
    return;
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    try {
      await handleCheckoutCompleted(event.data?.object ?? {});
    } catch (err) {
      // Respond 500 so Stripe retries the delivery (it backs off over hours).
      // Idempotency (provider_session_id) makes retries safe. A 200 here would
      // tell Stripe the event was handled and the purchase would be lost.
      req.log?.error?.({ err }, "premium webhook checkout handler error");
      res.status(500).json({ error: "handler_failed" });
      return;
    }
  }

  res.json({ received: true });
});

// ─── Admin: premium management ─────────────────────────────────────────────

interface PremiumUserRow {
  user_id: string;
  premium_expires_at: string | null;
  ads_seen_date: string | null;
  ads_seen_count: number;
  last_rewarded_at: string | null;
  is_premium: boolean;
  display_name?: string | null;
  username?: string | null;
  email?: string | null;
}

async function fetchProfiles(userIds: string[]): Promise<Map<string, { display_name: string | null; username: string | null; email: string | null }>> {
  const profiles = new Map<string, { display_name: string | null; username: string | null; email: string | null }>();
  const ids = [...new Set(userIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data } = await supabase
      .from("user_profiles")
      .select("user_id,display_name,username,email")
      .in("user_id", chunk);
    for (const row of data ?? []) {
      profiles.set(row.user_id, {
        display_name: row.display_name ?? null,
        username: row.username ?? null,
        email: row.email ?? null,
      });
    }
  }
  return profiles;
}

async function resolveUserId(input: { user_id?: string; email?: string; username?: string }): Promise<string | null> {
  if (input.user_id) return input.user_id;
  if (input.email) {
    const { data } = await supabase.from("user_profiles").select("user_id").ilike("email", input.email.trim()).maybeSingle();
    return data?.user_id ?? null;
  }
  if (input.username) {
    const { data } = await supabase.from("user_profiles").select("user_id").ilike("username", input.username.trim().toLowerCase()).maybeSingle();
    return data?.user_id ?? null;
  }
  return null;
}

router.get("/admin/premium/list", ...admin, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("user_premium")
      .select("user_id,premium_expires_at,ads_seen_date,ads_seen_count,last_rewarded_at,last_granted_date")
      .order("premium_expires_at", { ascending: false })
      .limit(200);

    if (error) {
      _req.log?.error?.({ err: error }, "GET /admin/premium/list supabase error");
      res.status(500).json({ error: "Failed to fetch premium users" });
      return;
    }

    const rows = (data ?? []) as unknown as Omit<PremiumUserRow, "is_premium">[];
    const profiles = await fetchProfiles(rows.map((r) => r.user_id));
    const now = Date.now();

    res.json(
      rows.map((r) => ({
        ...r,
        is_premium: isPremiumRow(r.premium_expires_at),
        display_name: profiles.get(r.user_id)?.display_name ?? null,
        username: profiles.get(r.user_id)?.username ?? null,
        email: profiles.get(r.user_id)?.email ?? null,
      })),
    );
  } catch (err) {
    _req.log?.error?.({ err }, "GET /admin/premium/list error");
    res.status(500).json({ error: "Failed to fetch premium users" });
  }
});

router.post("/admin/premium/grant", ...admin, async (req: Request, res: Response) => {
  try {
    const { user_id, email, username, days } = req.body as {
      user_id?: string;
      email?: string;
      username?: string;
      days?: number;
    };
    const d = Math.min(365, Math.max(1, Math.round(Number(days) || 30)));

    const userId = await resolveUserId({ user_id, email, username });
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { data: prev } = await supabase
      .from("user_premium")
      .select("premium_expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    const base = prev?.premium_expires_at ? new Date(prev.premium_expires_at).getTime() : Date.now();
    const expires = new Date(Math.max(Date.now(), base) + d * 86_400_000).toISOString();

    const { error } = await supabase.from("user_premium").upsert(
      { user_id: userId, premium_expires_at: expires, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

    if (error) {
      req.log?.error?.({ err: error }, "POST /admin/premium/grant upsert error");
      res.status(500).json({ error: "Failed to grant premium" });
      return;
    }

    res.json({ ok: true, user_id: userId, premium_until: expires, days: d });
  } catch (err) {
    req.log?.error?.({ err }, "POST /admin/premium/grant error");
    res.status(500).json({ error: "Failed to grant premium" });
  }
});

router.post("/admin/premium/settings", ...admin, async (req: Request, res: Response) => {
  try {
    const { ads_enabled, ads_target, reward_cooldown_s, grace_minutes, price_usd } = req.body as Record<string, unknown>;

    const updates: { key: string; value: unknown }[] = [];
    if (typeof ads_enabled === "boolean") updates.push({ key: "ads_enabled", value: ads_enabled });
    if (typeof ads_target === "number" && Number.isFinite(ads_target)) updates.push({ key: "ads_target", value: Math.max(1, Math.round(ads_target)) });
    if (typeof reward_cooldown_s === "number" && Number.isFinite(reward_cooldown_s)) updates.push({ key: "reward_cooldown_s", value: Math.max(0, Math.round(reward_cooldown_s)) });
    if (typeof grace_minutes === "number" && Number.isFinite(grace_minutes)) updates.push({ key: "grace_minutes", value: Math.max(0, Math.round(grace_minutes)) });
    if (typeof price_usd === "number" && Number.isFinite(price_usd)) updates.push({ key: "price_usd", value: Math.max(0.01, price_usd) });

    if (updates.length > 0) {
      const { error } = await supabase
        .from("site_settings")
        .upsert(updates.map((u) => ({ key: u.key, value: u.value, updated_at: new Date().toISOString() })), { onConflict: "key" });
      if (error) {
        req.log?.error?.({ err: error }, "POST /admin/premium/settings upsert error");
        res.status(500).json({ error: "Failed to update settings" });
        return;
      }
    }

    res.json(await getSettings());
  } catch (err) {
    req.log?.error?.({ err }, "POST /admin/premium/settings error");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;