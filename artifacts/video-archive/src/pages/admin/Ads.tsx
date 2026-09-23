import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAds, type AdRow } from "@/contexts/AdsContext";
import { AD_SLOTS } from "@/lib/ad-slots";
import { resolveApiPath } from "@/lib/api-base";
import {
  Megaphone, Plus, Trash2, Pencil, Check, X,
  AlertTriangle, RefreshCw, Code2, Link2, Radio, Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const SINGLE_URL = /^https?:\/\/\S+$/i;

const isSingleUrl = (s: string) => SINGLE_URL.test(s.trim()) && !/\s/.test(s.trim());

/**
 * Admin → Ads — full CRUD over the `ad_creatives` table (all 13
 * placeholders). Rows come from AdsContext (live via Supabase realtime),
 * mutations go through `/api/admin/ads` (service-role + requireRole), and
 * every save/delete is mirrored to all open pages instantly — no rebuild.
 */
export default function AdminAds() {
  const { session } = useAuth();
  const { rows, status, refresh } = useAds();

  const [activeSlot, setActiveSlot] = useState(AD_SLOTS[0].file);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

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

  const handleAdd = () => {
    const lines = draft.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
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
    if (!content) return;
    run(async () => {
      const kind = isSingleUrl(content) ? "url" : "html";
      await req(`/api/admin/ads/${row.id}`, "PATCH", { content, kind });
      setEditingId(null);
      setEditDraft("");
    }, "Creative updated");
  };

  const handleToggle = (row: AdRow) =>
    run(
      () => req(`/api/admin/ads/${row.id}`, "PATCH", { enabled: !row.enabled }),
      row.enabled ? "Creative disabled" : "Creative enabled",
    );

  const handleDelete = (row: AdRow) => {
    if (!window.confirm("Delete this creative permanently?")) return;
    run(() => req(`/api/admin/ads/${row.id}`, "DELETE"), "Creative deleted");
  };

  const totalOn = counts.get(activeSlot)?.on ?? 0;
  const totalRows = counts.get(activeSlot)?.total ?? 0;

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
            Add, edit and remove ads for every placeholder — changes go live on all open pages in realtime.
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
              <Badge variant="approved">
                {totalOn} live / {totalRows}
              </Badge>
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

            {/* Creative rows */}
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
                {slotRows.map((row) => (
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
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
