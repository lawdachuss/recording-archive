import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAds, type AdRow } from "@/contexts/AdsContext";
import {
  AD_SLOTS, AD_PAGES, AD_PLACEMENTS, DEFAULT_AD_SETTINGS, type AdSettings,
} from "@/lib/ad-slots";
import { resolveApiPath } from "@/lib/api-base";
import {
  Megaphone, Plus, Trash2, Pencil, Check, X,
  AlertTriangle, RefreshCw, Code2, Link2, Radio, Database,
  ChevronUp, ChevronDown, Copy, Eye, SlidersHorizontal, Save, RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const SINGLE_URL = /^https?:\/\/\S+$/i;
const IMAGE_EXT = /\.(gif|jpe?g|png|webp|avif|bmp)(\?|#|$)/i;

const isSingleUrl = (s: string) => SINGLE_URL.test(s.trim()) && !/\s/.test(s.trim());

/** Same heuristic the API uses: a lone http(s) URL with no spaces → url creative. */
const detectKind = (content: string): "html" | "url" =>
  isSingleUrl(content) ? "url" : "html";

/** Client-side mirror of the API's validation rules — errors appear before the round-trip. */
function validateContent(slot: string, content: string): string | null {
  const t = content.trim();
  if (!t) return "Content is empty";
  if (t.length > 200_000) return "Content exceeds 200,000 characters";
  if (detectKind(t) === "url" && slot !== "direct-link" && !IMAGE_EXT.test(t)) {
    return "Non-image URLs belong in the direct-link slot";
  }
  return null;
}

type TabId = "creatives" | "placements";

/**
 * Admin → Ads — the full ad control system:
 *
 *  • **Creatives tab** — CRUD over `ad_creatives` for all 13 placeholders:
 *    add (bulk URL lines), inline edit, enable/disable, duplicate, delete,
 *    clear-slot, rotation order (↑↓), and a sandboxed HTML preview.
 *  • **Placements tab** — WHERE ads show: per-page switches, per-zone
 *    switches (strips / in-feed / boxes / in-card / popunder / reward CTA),
 *    the in-card layer (max per page + source slot) and the rotation
 *    interval — all persisted to `ad_settings`.
 *
 * Rows/settings come from AdsContext (live via Supabase realtime on both
 * tables), mutations go through `/api/admin/ads` (service-role +
 * requireRole), and every change mirrors to all open pages instantly.
 */
export default function AdminAds() {
  const { session } = useAuth();
  const { rows, status, settings, refresh } = useAds();

  const [tab, setTab] = useState<TabId>("creatives");
  const [activeSlot, setActiveSlot] = useState(AD_SLOTS[0].file);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Placements draft — edited locally, persisted explicitly via Save.
  const [draftSettings, setDraftSettings] = useState<AdSettings>(settings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  // Follow realtime/context updates until the admin starts editing.
  useEffect(() => {
    if (!settingsDirty) setDraftSettings(settings);
  }, [settings, settingsDirty]);

  const headers = useCallback(() => {
    return {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    };
  }, [session]);

  const req = useCallback(
    async (path: string, method: string, body?: unknown): Promise<void> => {
      const res = await fetch(resolveApiPath(path), {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    },
    [headers],
  );

  /** Per-slot enabled/total counts. */
  const counts = useMemo(() => {
    const map = new Map<string, { total: number; on: number }>();
    for (const slot of AD_SLOTS) map.set(slot.file, { total: 0, on: 0 });
    for (const row of rows ?? []) {
      const c = map.get(row.slot);
      if (!c) continue;
      c.total += 1;
      if (row.enabled) c.on += 1;
    }
    return map;
  }, [rows]);

  const slotDef = AD_SLOTS.find((s) => s.file === activeSlot) ?? AD_SLOTS[0];
  const slotRows = useMemo(
    () => (rows ?? []).filter((r) => r.slot === activeSlot),
    [rows, activeSlot],
  );

  const run = async (fn: () => Promise<void>, okMessage: string) => {
    setBusy(true);
    setResult(null);
    try {
      await fn();
      await refresh();
      setResult({ type: "success", message: okMessage });
    } catch (e) {
      setResult({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  // ── Creatives actions ──────────────────────────────────────────────────

  const handleAdd = () => {
    const lines = draft.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    // Validate first: bulk URL pastes line-by-line, HTML as a whole block.
    const chunks = lines.every(isSingleUrl) ? lines : [lines.join("\n")];
    for (const chunk of chunks) {
      const err = validateContent(activeSlot, chunk);
      if (err) {
        setResult({ type: "error", message: err });
        return;
      }
    }
    const n = lines.length;
    run(async () => {
      if (lines.every(isSingleUrl)) {
        // One row per URL (direct-link pastes, multi-image adds).
        for (const url of lines) {
          await req("/api/admin/ads", "POST", { slot: activeSlot, kind: "url", content: url });
        }
      } else {
        await req("/api/admin/ads", "POST", { slot: activeSlot, content: lines.join("\n") });
      }
      setDraft("");
    }, `Added ${n === 1 ? "creative" : `${n} creatives`} to “${slotDef.label}”`);
  };

  const handleSave = (row: AdRow) => {
    const content = editDraft.trim();
    const err = validateContent(row.slot, content);
    if (err) {
      setResult({ type: "error", message: err });
      return;
    }
    run(async () => {
      await req(`/api/admin/ads/${row.id}`, "PATCH", { content, kind: detectKind(content) });
      setEditingId(null);
      setEditDraft("");
    }, "Creative updated");
  };

  const handleToggle = (row: AdRow) =>
    run(
      () => req(`/api/admin/ads/${row.id}`, "PATCH", { enabled: !row.enabled }),
      row.enabled ? "Creative disabled" : "Creative enabled",
    );

  const handleDuplicate = (row: AdRow) =>
    run(
      () =>
        req("/api/admin/ads", "POST", {
          slot: row.slot,
          kind: row.kind,
          content: row.content,
        }),
      "Creative duplicated (added at the end)",
    );

  const handleDelete = (row: AdRow) => {
    if (!window.confirm("Delete this creative permanently?")) return;
    run(() => req(`/api/admin/ads/${row.id}`, "DELETE"), "Creative deleted");
  };

  /** Swap a creative with its neighbour → new order sent in one request. */
  const handleMove = (index: number, dir: -1 | 1) => {
    const next = [...slotRows];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    run(
      () => req("/api/admin/ads/reorder", "PUT", { ids: next.map((r) => r.id) }),
      "Rotation order updated",
    );
  };

  const handleClearSlot = () => {
    if (
      !window.confirm(
        `Delete ALL ${totalRows} creatives in “${slotDef.label}”? This cannot be undone.`,
      )
    ) {
      return;
    }
    run(
      () => req(`/api/admin/ads/slot/${activeSlot}`, "DELETE"),
      `Cleared “${slotDef.label}”`,
    );
  };

  // ── Placements actions ─────────────────────────────────────────────────

  /** Toggle reads the draft with “missing key = ON” semantics. */
  const toggleFlag = (bucket: "pages" | "placements", id: string) => {
    setDraftSettings((s) => {
      const current = s[bucket][id] !== false;
      return { ...s, [bucket]: { ...s[bucket], [id]: !current } };
    });
    setSettingsDirty(true);
  };

  const patchInCard = (patch: Partial<AdSettings["inCard"]>) => {
    setDraftSettings((s) => ({ ...s, inCard: { ...s.inCard, ...patch } }));
    setSettingsDirty(true);
  };

  const handleSaveSettings = () =>
    run(async () => {
      await req("/api/admin/ads/settings", "PUT", draftSettings);
      setSettingsDirty(false);
    }, "Placement settings saved — live on every open page");

  const handleResetSettings = () => {
    setDraftSettings(DEFAULT_AD_SETTINGS);
    setSettingsDirty(true);
  };

  const totalOn = counts.get(activeSlot)?.on ?? 0;
  const totalRows = counts.get(activeSlot)?.total ?? 0;
  const inCardSlots = AD_SLOTS.filter(
    (s) => s.file !== "popunder" && s.file !== "direct-link",
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-2">
            <Megaphone className="w-3.5 h-3.5 text-primary" />
            Admin
          </div>
          <h1 className="text-2xl font-black tracking-tighter">Ad Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add, edit, reorder and remove ads — and control exactly where they show. All changes go
            live on every open page in realtime.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status === "database" && (
            <Badge variant="approved" className="gap-1">
              <Radio className="w-3 h-3" /> Live · Supabase
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 w-fit rounded-lg bg-secondary/40 border border-border/40 mb-6">
        {(
          [
            ["creatives", "Creatives", Code2],
            ["placements", "Placements", SlidersHorizontal],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === id
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Source warnings */}
      {status === "file" && (
        <div className="flex items-start gap-2 p-4 mb-4 rounded-md text-sm border bg-destructive/10 border-destructive/30 text-destructive">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs font-mono">
            Supabase unreachable or the <b>ad_creatives</b> table is missing — the site is running on the
            ads/*.txt file fallback and panel changes won't render. Run{" "}
            <b>supabase/migrations/011-ads.sql</b> in the Supabase SQL Editor, then refresh.
          </div>
        </div>
      )}
      {status === "database" && rows !== null && rows.length === 0 && (
        <div className="flex items-start gap-2 p-4 mb-4 rounded-md text-sm border bg-yellow-500/10 border-yellow-500/30 text-yellow-500">
          <Database className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs font-mono">
            Connected, but the table is empty — in database mode the ads/*.txt fallback is NOT used, so no
            ads are showing. Run <b>supabase/migrations/011-ads.sql</b> to seed your existing creatives,
            or add new ones below.
          </div>
        </div>
      )}

      {result && (
        <div
          className={`flex items-start gap-2 p-4 mb-4 rounded-md text-sm border ${
            result.type === "success"
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}
        >
          {result.type === "success" ? (
            <Check className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <div className="font-mono text-xs">{result.message}</div>
        </div>
      )}

      {tab === "creatives" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Slot picker */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-sm font-bold tracking-tight">Placeholders</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {AD_SLOTS.map((slot) => {
                const c = counts.get(slot.file)!;
                const active = slot.file === activeSlot;
                return (
                  <button
                    key={slot.file}
                    onClick={() => {
                      setActiveSlot(slot.file);
                      setEditingId(null);
                      setPreviewId(null);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-all text-left ${
                      active
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{slot.label}</span>
                      <span className="block text-[10px] uppercase tracking-wider opacity-70">{slot.size}</span>
                    </span>
                    <Badge variant={c.on > 0 ? "approved" : "outline"} className="shrink-0">
                      {c.on}/{c.total}
                    </Badge>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Active slot detail */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
                    {activeSlot === "direct-link" ? (
                      <Link2 className="w-4 h-4 text-primary" />
                    ) : activeSlot === "popunder" ? (
                      <Code2 className="w-4 h-4 text-primary" />
                    ) : (
                      <Megaphone className="w-4 h-4 text-primary" />
                    )}
                    {slotDef.label}
                    <Badge variant="outline">{slotDef.size}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{slotDef.note}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="approved">
                    {totalOn} live / {totalRows}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-destructive"
                    title="Delete every creative in this slot"
                    onClick={handleClearSlot}
                    disabled={busy || totalRows === 0}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add form */}
              <div className="space-y-2">
                <textarea
                  className={TEXTAREA_CLASS + " min-h-[88px] font-mono text-xs"}
                  placeholder={
                    activeSlot === "direct-link"
                      ? "https://affiliate-link.example/…  (one URL per line)"
                      : activeSlot === "popunder"
                        ? "Paste your popunder <script>…</script> code here"
                        : "Paste an image URL (one per line) or a full HTML/JS ad code…"
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy}
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Multiple URL lines are added as separate rotating creatives.
                  </span>
                  <Button size="sm" onClick={handleAdd} disabled={busy || !draft.trim()}>
                    <Plus className="w-3.5 h-3.5" />
                    Add{draft.trim() && draft.includes("\n") ? " all" : ""}
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Creative rows (rotation follows this order — ↑↓ reorders) */}
              {status === "pending" ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-14 bg-muted/30 rounded animate-pulse" />
                  ))}
                </div>
              ) : slotRows.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground border border-dashed border-border/40 rounded-lg">
                  No creatives in this slot yet — the site shows a styled size placeholder until you add one.
                </div>
              ) : (
                <div className="space-y-2">
                  {slotRows.map((row, i) => (
                    <div
                      key={row.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-secondary/10 ${
                        row.enabled ? "" : "opacity-50"
                      }`}
                    >
                      {/* Preview */}
                      {row.kind === "url" ? (
                        <img
                          src={row.content}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-20 h-16 object-contain bg-black rounded border border-border/40 shrink-0"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                          }}
                        />
                      ) : (
                        <div className="w-20 h-16 flex items-center justify-center bg-black/40 rounded border border-border/40 shrink-0">
                          <Code2 className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {editingId === row.id ? (
                          <textarea
                            className={TEXTAREA_CLASS + " min-h-[72px] font-mono text-xs"}
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            autoFocus
                          />
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[9px] uppercase">
                                {row.kind === "url" ? "Image URL" : "HTML/JS"}
                              </Badge>
                              {!row.enabled && <Badge variant="rejected">Disabled</Badge>}
                            </div>
                            <div className="text-[11px] font-mono text-muted-foreground break-all line-clamp-2">
                              {row.content}
                            </div>
                            {/* Sandboxed live preview for HTML creatives */}
                            {previewId === row.id && row.kind === "html" && (
                              <iframe
                                title="Creative preview"
                                sandbox="allow-scripts allow-popups"
                                srcDoc={row.content}
                                className="w-full h-28 mt-2 rounded border border-border/40 bg-black"
                              />
                            )}
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {/* Rotation order */}
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-1.5"
                            title="Move up in rotation order"
                            onClick={() => handleMove(i, -1)}
                            disabled={busy || i === 0}
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-1.5"
                            title="Move down in rotation order"
                            onClick={() => handleMove(i, 1)}
                            disabled={busy || i === slotRows.length - 1}
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        <div className="flex items-center gap-1">
                          {editingId === row.id ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => handleSave(row)}
                                disabled={busy}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditDraft("");
                                }}
                                disabled={busy}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                title={row.enabled ? "Disable" : "Enable"}
                                onClick={() => handleToggle(row)}
                                disabled={busy}
                              >
                                {row.enabled ? <Check className="w-3.5 h-3.5 text-green-400" /> : <X className="w-3.5 h-3.5" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                title="Edit"
                                onClick={() => {
                                  setEditingId(row.id);
                                  setEditDraft(row.content);
                                }}
                                disabled={busy}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                title="Duplicate (adds a copy at the end)"
                                onClick={() => handleDuplicate(row)}
                                disabled={busy}
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                              {row.kind === "html" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  title={previewId === row.id ? "Hide preview" : "Preview (sandboxed)"}
                                  onClick={() => setPreviewId(previewId === row.id ? null : row.id)}
                                  disabled={busy}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-destructive"
                                title="Delete"
                                onClick={() => handleDelete(row)}
                                disabled={busy}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* ── Placements tab ─────────────────────────────────────────── */
        <div className="space-y-6 max-w-5xl">
          {/* Pages */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-bold tracking-tight">Show ads on which pages</CardTitle>
              <p className="text-xs text-muted-foreground">
                Turn a page off and every ad on it disappears instantly (banners, in-card layer,
                popunder). Auth, premium and admin pages are always excluded regardless.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {AD_PAGES.map((page) => {
                  const on = draftSettings.pages[page.id] !== false;
                  return (
                    <button
                      key={page.id}
                      onClick={() => toggleFlag("pages", page.id)}
                      disabled={busy}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm transition-all ${
                        on
                          ? "bg-primary/10 border-primary/20 text-primary"
                          : "bg-destructive/5 border-destructive/30 text-destructive"
                      }`}
                    >
                      <span className="truncate">{page.label}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider shrink-0">
                        {on ? "On" : "Off"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Zones */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-bold tracking-tight">Show ads in which zones</CardTitle>
              <p className="text-xs text-muted-foreground">
                Each placement type across the whole site — turning one off hides it completely
                (no placeholders).
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {AD_PLACEMENTS.map((zone) => {
                const on = draftSettings.placements[zone.id] !== false;
                return (
                  <div
                    key={zone.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/40 bg-secondary/10"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{zone.label}</div>
                      <div className="text-[11px] text-muted-foreground">{zone.note}</div>
                    </div>
                    <button
                      onClick={() => toggleFlag("placements", zone.id)}
                      disabled={busy}
                      className={`shrink-0 px-3 py-1 rounded-md border text-xs font-bold uppercase tracking-wider transition-all ${
                        on
                          ? "bg-primary/10 border-primary/20 text-primary"
                          : "bg-destructive/5 border-destructive/30 text-destructive"
                      }`}
                    >
                      {on ? "On" : "Off"}
                    </button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* In-card + rotation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-bold tracking-tight">In-card layer &amp; rotation</CardTitle>
              <p className="text-xs text-muted-foreground">
                Fine-tune the thumbnail ad overlay and how fast creatives rotate inside every slot.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">In-card ads per page (0–6)</span>
                <select
                  className={SELECT_CLASS + " w-full"}
                  value={draftSettings.inCard.maxPerPage}
                  onChange={(e) => patchInCard({ maxPerPage: Number(e.target.value) })}
                  disabled={busy}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "0 (off)" : n}
                    </option>
                  ))}
                </select>
                <span className="block text-[11px] text-muted-foreground">
                  How many video thumbnails may carry an ad (grid picks them randomly).
                </span>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">In-card source slot</span>
                <select
                  className={SELECT_CLASS + " w-full"}
                  value={draftSettings.inCard.slot}
                  onChange={(e) => patchInCard({ slot: e.target.value })}
                  disabled={busy}
                >
                  {inCardSlots.map((s) => (
                    <option key={s.file} value={s.file}>
                      {s.label} · {s.size}
                    </option>
                  ))}
                </select>
                <span className="block text-[11px] text-muted-foreground">
                  Which placeholder feeds the overlay (creative is contained — never cropped).
                </span>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">Rotation interval (seconds)</span>
                <select
                  className={SELECT_CLASS + " w-full"}
                  value={draftSettings.rotationSeconds}
                  onChange={(e) =>
                    setDraftSettings((s) => ({ ...s, rotationSeconds: Number(e.target.value) }))
                  }
                  disabled={busy}
                >
                  {[10, 15, 20, 30, 45, 60, 90, 120].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
                <span className="block text-[11px] text-muted-foreground">
                  How long each creative shows before the next one rotates in.
                </span>
              </label>
            </CardContent>
          </Card>

          {/* Save bar */}
          <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-border/40 bg-secondary/10">
            <span className="text-xs text-muted-foreground">
              {settingsDirty
                ? "Unsaved changes — press Save to apply them everywhere (realtime)."
                : "Saved — every open page follows this configuration live."}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={busy}>
                <RotateCcw className="w-3.5 h-3.5" />
                Reset defaults
              </Button>
              <Button size="sm" onClick={handleSaveSettings} disabled={busy || !settingsDirty}>
                <Save className="w-3.5 h-3.5" />
                Save placements
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
