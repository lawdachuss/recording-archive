import { Router, type IRouter, type Request, type Response } from "express";
import { supabase } from "../lib/supabase.js";
import { requireRole } from "../middleware/requireRole.js";

/**
 * Admin ad-creative CRUD (`/api/admin/ads` …).
 *
 * Every write goes through the service-role client (bypasses RLS); the
 * `ad_creatives` table itself is publicly readable and registered with the
 * supabase_realtime publication, so every open page (AdsContext) picks
 * changes up instantly.
 *
 * The SLOTS set must stay in sync with
 * artifacts/video-archive/src/lib/ad-slots.ts (and ads/*.txt).
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
]);

const IMAGE_EXT = /\.(gif|jpe?g|png|webp|avif|bmp)(\?|#|$)/i;
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
  if (kind === "url") {
    if (!URL_RE.test(t) || /\s/.test(t)) return "URL creatives must be a single http(s) URL";
    if (slot !== "direct-link" && !IMAGE_EXT.test(t)) {
      return "Non-image URLs belong in the direct-link slot";
    }
  }
  return null;
}

// ─── List (all creatives, every slot, incl. disabled) ────────────────────

router.get("/admin/ads", ...admin, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("ad_creatives")
    .select("*")
    .order("slot", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    req.log?.error?.({ err: error }, "GET /admin/ads failed");
    res.status(500).json({
      error: String(error.message ?? "").includes("ad_creatives")
        ? "The ad_creatives table is missing — run supabase/migrations/011-ads.sql in the Supabase SQL Editor."
        : String(error.message ?? "Failed to load ads"),
    });
    return;
  }
  res.json(data ?? []);
});

// ─── Create ──────────────────────────────────────────────────────────────

router.post("/admin/ads", ...admin, async (req: Request, res: Response) => {
  const slot = String(req.body?.slot ?? "");
  const content = String(req.body?.content ?? "");
  const kind = pickKind(req.body?.kind, content);
  const invalid = validate(slot, kind, content);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const { data, error } = await supabase
    .from("ad_creatives")
    .insert({ slot, kind, content: content.trim() })
    .select("*")
    .single();
  if (error) {
    req.log?.error?.({ err: error }, "POST /admin/ads failed");
    res.status(500).json({ error: String(error.message ?? "Insert failed") });
    return;
  }
  res.status(201).json(data);
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

  const { data, error } = await supabase
    .from("ad_creatives")
    .update({
      kind,
      content: content.trim(),
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

// ─── Delete ──────────────────────────────────────────────────────────────

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

export default router;
