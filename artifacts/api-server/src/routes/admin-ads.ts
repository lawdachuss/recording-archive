import { Router, type IRouter, type Request, type Response } from "express";
import { supabase } from "../lib/supabase.js";
import { requireRole } from "../middleware/requireRole.js";
import { sniffBannerUrl, slotDims } from "../lib/ad-sniff.js";

/**
 * Admin ad system — creatives CRUD + placement settings.
 *
 *   GET    /admin/ads               list creatives (slot, sort_order)
 *   POST   /admin/ads               create (appended to the slot)
 *   PATCH  /admin/ads/:id           edit content / kind / enabled
 *   DELETE /admin/ads/:id           delete one
 *   DELETE /admin/ads/slot/:slot    clear a whole slot
 *   PUT    /admin/ads/reorder       { ids: [...] } rotation order
 *   GET    /admin/ads/settings      placement config (singleton row)
 *   PUT    /admin/ads/settings      replace placement config
 *
 * All writes go through the service-role client (bypasses RLS); both tables
 * are publicly readable and realtime-registered, so every open page picks
 * changes up instantly. The id sets must stay in sync with
 * artifacts/video-archive/src/lib/ad-slots.ts.
 */
const router: IRouter = Router();

const admin = requireRole("admin");

const SLOTS = new Set([
  "billboard-970x250",
  "super-leaderboard-970x90",
  "leaderboard-728x90",
  "banner-468x60",
  "mobile-banner-320x50",
  "rect-300x100",
  "medium-rect-300x250",
  "large-rect-336x280",
  "half-page-300x600",
  "skyscraper-160x600",
  "square-250x250",
  "popunder",
  "direct-link",
  "preroll",
]);

/** Slots that may feed the in-card thumbnail layer (banner slots — not popunder/direct-link/preroll). */
const IN_CARD_SLOTS = new Set(
  [...SLOTS].filter((s) => s !== "popunder" && s !== "direct-link" && s !== "preroll"),
);

const PAGE_IDS = new Set([
  "home", "browse", "video", "performers", "playlists", "tags", "collections",
  "bookmarks", "history", "watch-later", "analytics", "following",
  "notifications", "my-requests", "request", "profile", "settings",
]);

const PLACEMENT_IDS = new Set(["strip", "feed", "box", "inCard", "popunder", "rewardCta", "stripcash", "preroll"]);

const URL_RE = /^https?:\/\/\S+$/i;
const MAX_CONTENT = 200_000;

type Kind = "html" | "url";

/** A lone http(s) URL with no whitespace → url creative, else raw HTML/JS. */
function detectKind(content: string): Kind {
  const t = content.trim();
  return URL_RE.test(t) && !/\s/.test(t) ? "url" : "html";
}

function pickKind(raw: unknown, content: string): Kind {
  return raw === "html" || raw === "url" ? raw : detectKind(content);
}

/** Returns an error message, or null when the (slot, kind, content) trio is valid. */
function validate(slot: string, kind: Kind, content: string): string | null {
  if (!SLOTS.has(slot)) return `Unknown ad slot "${slot}"`;
  const t = content.trim();
  if (!t) return "Content is empty";
  if (t.length > MAX_CONTENT) return `Content exceeds ${MAX_CONTENT} characters`;
  if (kind === "url" && (!URL_RE.test(t) || /\s/.test(t))) {
    return "URL creatives must be a single http(s) URL";
  }
  return null;
}

/**
 * Keep only known settings keys and clamp numbers — anything unexpected in
 * the request body never reaches the database. Absent keys stay absent
 * (read-side merge treats missing as default/on).
 */
function sanitizeSettings(input: unknown): Record<string, unknown> {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (src.pages && typeof src.pages === "object") {
    const pages: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(src.pages as Record<string, unknown>)) {
      if (PAGE_IDS.has(k) && typeof v === "boolean") pages[k] = v;
    }
    out.pages = pages;
  }

  if (src.placements && typeof src.placements === "object") {
    const zones: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(src.placements as Record<string, unknown>)) {
      if (PLACEMENT_IDS.has(k) && typeof v === "boolean") zones[k] = v;
    }
    out.placements = zones;
  }

  if (src.inCard && typeof src.inCard === "object") {
    const ic = src.inCard as Record<string, unknown>;
    const inCard: Record<string, unknown> = {};
    const max = Number(ic.maxPerPage);
    if (Number.isFinite(max)) inCard.maxPerPage = Math.max(0, Math.min(6, Math.round(max)));
    if (typeof ic.slot === "string" && IN_CARD_SLOTS.has(ic.slot)) inCard.slot = ic.slot;
    out.inCard = inCard;
  }

  const rot = Number(src.rotationSeconds);
  if (Number.isFinite(rot)) out.rotationSeconds = Math.max(5, Math.min(120, Math.round(rot)));

  return out;
}

// ─── List ────────────────────────────────────────────────────────────────

router.get("/admin/ads", ...admin, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("ad_creatives")
    .select("*")
    .order("slot", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    req.log?.error?.({ err: error }, "GET /admin/ads failed");
    res.status(500).json({
      error: String(error.message ?? "").includes("ad_creatives")
        ? "The ad_creatives table is missing — run supabase/migrations/011-ads.sql (and 012-ad-settings.sql) in the Supabase SQL Editor."
        : String(error.message ?? "Failed to load ads"),
    });
    return;
  }
  res.json(data ?? []);
});

// ─── Create (appended after the slot's last creative) ────────────────────

router.post("/admin/ads", ...admin, async (req: Request, res: Response) => {
  const slot = String(req.body?.slot ?? "");
  const content = String(req.body?.content ?? "");
  const kind = pickKind(req.body?.kind, content);
  const invalid = validate(slot, kind, content);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }

  // Auto-embed: a bare pasted LINK is probed once and stored as the creative
  // it should actually render as (sized <img> / slot <iframe> / click box) —
  // the admin never has to hand-copy <iframe> codes. Banner slots only:
  // popunder/direct-link have no dimensions and keep raw content by design.
  let storeKind = kind;
  let storeContent = content.trim();
  if (detectKind(storeContent) === "url") {
    const dims = slotDims(slot);
    if (dims) {
      const decided = await sniffBannerUrl(storeContent, dims);
      req.log?.info?.({ slot, url: storeContent, kind: decided.kind }, "admin ad link auto-embed");
      storeKind = decided.kind;
      storeContent = decided.content;
    }
  }

  const { data: last } = await supabase
    .from("ad_creatives")
    .select("sort_order")
    .eq("slot", slot)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("ad_creatives")
    .insert({
      slot,
      kind: storeKind,
      content: storeContent,
      sort_order: (Number(last?.sort_order) || -1) + 1,
    })
    .select("*")
    .single();
  if (error) {
    req.log?.error?.({ err: error }, "POST /admin/ads failed");
    res.status(500).json({ error: String(error.message ?? "Insert failed") });
    return;
  }
  res.status(201).json(data);
});

// ─── Reorder (rotation order within slots) ───────────────────────────────

router.put("/admin/ads/reorder", ...admin, async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length === 0 || ids.length > 500) {
    res.status(400).json({ error: "ids must be a non-empty array (max 500)" });
    return;
  }
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 1) {
    const { error } = await supabase
      .from("ad_creatives")
      .update({ sort_order: i, updated_at: now })
      .eq("id", ids[i]);
    if (error) {
      req.log?.error?.({ err: error }, "PUT /admin/ads/reorder failed");
      res.status(500).json({ error: String(error.message ?? "Reorder failed") });
      return;
    }
  }
  res.json({ ok: true, count: ids.length });
});

// ─── Update (content / kind / enabled) ───────────────────────────────────

router.patch("/admin/ads/:id", ...admin, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  const { data: existing, error: fetchErr } = await supabase
    .from("ad_creatives")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    res.status(500).json({ error: String(fetchErr.message ?? "Fetch failed") });
    return;
  }
  if (!existing) {
    res.status(404).json({ error: "Creative not found" });
    return;
  }

  const content =
    req.body?.content !== undefined ? String(req.body.content) : existing.content;
  const kind =
    req.body?.kind !== undefined
      ? pickKind(req.body.kind, content)
      : req.body?.content !== undefined
        ? detectKind(content)
        : existing.kind;
  const enabled =
    typeof req.body?.enabled === "boolean" ? req.body.enabled : existing.enabled;

  const invalid = validate(existing.slot, kind, content);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }

  // Same auto-embed probe as POST — only when content itself is being
  // edited to a bare link (an enabled-only toggle must not re-sniff).
  let storeKind = kind;
  let storeContent = content.trim();
  if (req.body?.content !== undefined && detectKind(storeContent) === "url") {
    const dims = slotDims(existing.slot);
    if (dims) {
      const decided = await sniffBannerUrl(storeContent, dims);
      req.log?.info?.({ slot: existing.slot, url: storeContent, kind: decided.kind }, "admin ad link auto-embed");
      storeKind = decided.kind;
      storeContent = decided.content;
    }
  }

  const { data, error } = await supabase
    .from("ad_creatives")
    .update({
      kind: storeKind,
      content: storeContent,
      enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    req.log?.error?.({ err: error }, "PATCH /admin/ads failed");
    res.status(500).json({ error: String(error.message ?? "Update failed") });
    return;
  }
  res.json(data);
});

// ─── Delete one ──────────────────────────────────────────────────────────

router.delete("/admin/ads/:id", ...admin, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const { error } = await supabase.from("ad_creatives").delete().eq("id", id);
  if (error) {
    req.log?.error?.({ err: error }, "DELETE /admin/ads failed");
    res.status(500).json({ error: String(error.message ?? "Delete failed") });
    return;
  }
  res.json({ ok: true });
});

// ─── Clear a whole slot ──────────────────────────────────────────────────

router.delete("/admin/ads/slot/:slot", ...admin, async (req: Request, res: Response) => {
  const slot = String(req.params.slot ?? "");
  if (!SLOTS.has(slot)) {
    res.status(400).json({ error: `Unknown ad slot "${slot}"` });
    return;
  }
  const { data, error } = await supabase
    .from("ad_creatives")
    .delete()
    .eq("slot", slot)
    .select("id");
  if (error) {
    req.log?.error?.({ err: error }, "DELETE /admin/ads/slot failed");
    res.status(500).json({ error: String(error.message ?? "Clear failed") });
    return;
  }
  res.json({ ok: true, deleted: (data ?? []).length });
});

// ─── Placement settings (singleton row id = 1) ───────────────────────────

router.get("/admin/ads/settings", ...admin, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("ad_settings")
    .select("config, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    req.log?.error?.({ err: error }, "GET /admin/ads/settings failed");
    res.status(500).json({
      error: String(error.message ?? "").includes("ad_settings")
        ? "The ad_settings table is missing — run supabase/migrations/012-ad-settings.sql in the Supabase SQL Editor."
        : String(error.message ?? "Failed to load settings"),
    });
    return;
  }
  res.json({ config: data?.config ?? {}, updated_at: data?.updated_at ?? null });
});

router.put("/admin/ads/settings", ...admin, async (req: Request, res: Response) => {
  const config = sanitizeSettings(req.body);
  const { data, error } = await supabase
    .from("ad_settings")
    .upsert({ id: 1, config, updated_at: new Date().toISOString() })
    .select("config, updated_at")
    .single();
  if (error) {
    req.log?.error?.({ err: error }, "PUT /admin/ads/settings failed");
    res.status(500).json({ error: String(error.message ?? "Save failed") });
    return;
  }
  res.json({ config: data?.config ?? {}, updated_at: data?.updated_at ?? null });
});

export default router;
