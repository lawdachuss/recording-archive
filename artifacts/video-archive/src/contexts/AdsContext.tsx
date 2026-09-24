import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { resolveApiPath } from "@/lib/api-base";
import {
  bareUrlToMarkup,
  getAdCreatives,
  getDirectLink,
  parseAdDimensions,
  PINNED_IN_CARD_LIMIT,
  setAdCardLimit,
  stripAdComments,
} from "@/lib/ad-creatives";
import { DEFAULT_AD_SETTINGS, mergeAdSettings, type AdSettings } from "@/lib/ad-slots";

/** One row of the Supabase `ad_creatives` table. */
export interface AdRow {
  id: string;
  slot: string;
  kind: "html" | "url";
  content: string;
  enabled: boolean;
  sort_order?: number;
}

/**
 * Where creatives currently come from:
 *  - "pending"   → first fetch not settled yet (file creatives render meanwhile)
 *  - "database"  → Supabase `ad_creatives` is AUTHORITATIVE (even when empty)
 *  - "file"      → Supabase unreachable / table missing → ads/*.txt fallback
 */
export type AdsStatus = "pending" | "database" | "file";

/** StripCash (Stripchat) smartlink status from `GET /api/ads/stripcash`. */
export interface StripCashConfig {
  /** Server env has a usable key (or STRIPCASH_SMARTLINK override). */
  configured: boolean;
  /** Last probe of the smartlink saw a live redirect (10-min server cache). */
  verified: boolean;
  /** Tracked smartlink, or null when nothing usable is configured. */
  smartlink: string | null;
}

interface AdsContextValue {
  /** All rows (null until the first fetch settles). Admin panel reads these raw. */
  rows: AdRow[] | null;
  status: AdsStatus;
  /**
   * Placement config (Admin → Ads → Placements): per-page switches, zone
   * switches, in-card options, rotation interval. Defaults until loaded;
   * updates in realtime with everything else.
   */
  settings: AdSettings;
  /**
   * Creatives that should render in a banner/popunder slot right now
   * (enabled only, in rotation order). Stable per slot identity — arrays are
   * reused while their content doesn't change, so unrelated ad edits never
   * re-inject the slots that didn't change.
   */
  creativesFor(slot: string): string[];
  /** Random direct-link for CTAs; stable per page load; null when the reward CTA zone is off. */
  directLink: string | null;
  /**
   * StripCash smartlink status (null until the fetch settles, and it stays
   * null when the endpoint is unreachable — StripCash then simply contributes
   * no candidates; other ads are unaffected). Feeds the direct-link pool and
   * the popunder rotation whenever its zone switch is on.
   */
  stripcash: StripCashConfig | null;
  /** Re-fetch creatives + settings now (admin panel's manual refresh button). */
  refresh(): Promise<void>;
}

const AdsContext = createContext<AdsContextValue | null>(null);

const TABLE = "ad_creatives";
const SETTINGS_TABLE = "ad_settings";

/**
 * AdsProvider — loads `ad_creatives` + `ad_settings` from Supabase once per
 * page load and keeps both fresh through a postgres_changes REALTIME
 * subscription, so any add/edit/remove/placement change made in Admin → Ads
 * is visible on every open page immediately (no rebuild, no reload). Falls
 * back to the build-time ads/*.txt files when the creatives table can't be
 * reached, and to default settings when ad_settings can't.
 *
 * Mounted once in App.tsx — OUTSIDE PremiumProvider, because the page
 * switches in `settings` feed PremiumContext's `showAds` predicate.
 */
export function AdsProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<AdRow[] | null>(null);
  const [status, setStatus] = useState<AdsStatus>("pending");
  const [settings, setSettings] = useState<AdSettings>(DEFAULT_AD_SETTINGS);
  const [stripcash, setStripCash] = useState<StripCashConfig | null>(null);
  const sbRef = useRef<SupabaseClient | null>(null);
  /** Per-slot memo so unchanged slots keep their array identity across fetches. */
  const slotCache = useRef(new Map<string, string[]>());

  const load = useCallback(async () => {
    const sb = sbRef.current ?? (await getSupabase());
    sbRef.current = sb;
    const { data, error } = await sb.from(TABLE).select("*");
    if (error) throw error;
    const next = (data ?? []) as AdRow[];
    setRows((prev) => {
      // Keep the old array identity when nothing actually changed (realtime
      // fires for edits in ANY slot — unrelated edits must not re-render).
      if (
        prev &&
        prev.length === next.length &&
        prev.every((row, i) => JSON.stringify(row) === JSON.stringify(next[i]))
      ) {
        return prev;
      }
      return next;
    });
    setStatus("database");
  }, []);

  // Placement config is best-effort: a missing/failed ad_settings read just
  // keeps the defaults (ads on, 2 in-card cards, 20s rotation) — it must
  // never take the creatives down with it.
  const loadSettings = useCallback(async () => {
    const sb = sbRef.current ?? (await getSupabase());
    sbRef.current = sb;
    const { data, error } = await sb
      .from(SETTINGS_TABLE)
      .select("config")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    setSettings(mergeAdSettings(data?.config ?? {}));
  }, []);

  const refresh = useCallback(async () => {
    try {
      await load();
    } catch (err) {
      console.warn(
        "[ads] refresh failed:",
        err instanceof Error ? err.message : err,
      );
    }
    try {
      await loadSettings();
    } catch {
      /* keep current settings */
    }
  }, [load, loadSettings]);

  // Push the PINNED in-card limit into the isAdCard picker (module state —
  // grids pick it up on their next render/navigation). The count is fixed in
  // code so every deployment renders the same grids; the DB/admin value is
  // intentionally NOT applied here (see PINNED_IN_CARD_LIMIT).
  useEffect(() => {
    setAdCardLimit(PINNED_IN_CARD_LIMIT);
  }, [settings]);

  // StripCash smartlink — best-effort like settings: endpoint down or key not
  // configured just means StripCash adds no candidates (never breaks others).
  useEffect(() => {
    let alive = true;
    fetch(resolveApiPath("/api/ads/stripcash"), { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { configured?: unknown; verified?: unknown; smartlink?: unknown } | null) => {
        if (!alive || !d) return;
        setStripCash({
          configured: Boolean(d.configured),
          verified: Boolean(d.verified),
          smartlink: typeof d.smartlink === "string" && d.smartlink ? d.smartlink : null,
        });
      })
      .catch(() => {
        /* StripCash stays off — other ads keep working */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let channel: RealtimeChannel | null = null;
    // If the fetch hangs (blocked network etc.), settle on the file fallback
    // so the popunder and CTAs aren't stuck "pending" forever.
    const fallbackTimer = window.setTimeout(() => {
      if (alive) setStatus((s) => (s === "pending" ? "file" : s));
    }, 5000);

    loadSettings().catch((err) => {
      console.warn(
        "[ads] ad_settings unavailable, using defaults:",
        err instanceof Error ? err.message : err,
      );
    });

    (async () => {
      try {
        await load();
        if (!alive) return;
        const sb = sbRef.current;
        if (!sb) return;
        // Any change on either table → refetch → every mounted ad slot and
        // every placement gate re-renders with the new state instantly.
        channel = sb
          .channel(`ads-${Math.random().toString(36).slice(2, 8)}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: TABLE },
            () => {
              load().catch(() => {});
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: SETTINGS_TABLE },
            () => {
              loadSettings().catch(() => {});
            },
          )
          .subscribe((state) => {
            if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              console.warn(
                `[ads] realtime subscription failed (${state}) — live ad edits need ` +
                  "ad_creatives + ad_settings in the supabase_realtime publication (migrations 011/012).",
              );
            }
          });
      } catch (err) {
        // Table missing, RLS denial, offline, SDK failure → ads/*.txt files.
        console.warn(
          "[ads] Supabase unavailable, using ads/*.txt fallback:",
          err instanceof Error ? err.message : err,
        );
        if (alive) setStatus((s) => (s === "pending" ? "file" : s));
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(fallbackTimer);
      if (channel) {
        const ch = channel;
        getSupabase()
          .then((sb) => sb.removeChannel(ch))
          .catch(() => {});
      }
    };
  }, [load, loadSettings]);

  const dbRows = status === "database" && rows ? rows : null;

  const creativesFor = useMemo(() => {
    if (!dbRows) return getAdCreatives;
    const build = (slot: string): string[] => {
      const out: string[] = [];
      for (const row of dbRows) {
        if (row.slot !== slot || !row.enabled) continue;
        if (row.kind === "url") {
          const { width, height } = parseAdDimensions(slot);
          const markup = bareUrlToMarkup(row.content.trim(), width, height);
          if (markup) out.push(markup);
        } else {
          out.push(stripAdComments(row.content));
        }
      }
      return out;
    };
    return (slot: string): string[] => {
      const next = build(slot);
      const cached = slotCache.current.get(slot);
      if (
        cached &&
        cached.length === next.length &&
        cached.every((v, i) => v === next[i])
      ) {
        return cached;
      }
      slotCache.current.set(slot, next);
      return next;
    };
  }, [dbRows]);

  const directLink = useMemo(() => {
    // Reward-CTA zone switched off in Admin → Placements → no link opens.
    if (settings.placements.rewardCta === false) return null;
    const pool: string[] = [];
    if (dbRows) {
      for (const r of dbRows) {
        if (
          r.slot === "direct-link" &&
          r.enabled &&
          r.kind === "url" &&
          /^https?:\/\/\S+$/i.test(r.content.trim())
        ) {
          pool.push(r.content.trim());
        }
      }
    } else {
      const fileLink = getDirectLink();
      if (fileLink) pool.push(fileLink);
    }
    // StripCash smartlink rotates into the same pool (its own zone switch);
    // in database mode it also keeps the CTA alive when no direct-link rows exist.
    if (settings.placements.stripcash !== false && stripcash?.smartlink) {
      pool.push(stripcash.smartlink);
    }
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [dbRows, settings.placements.rewardCta, settings.placements.stripcash, stripcash]);

  const value = useMemo(
    () => ({ rows, status, settings, creativesFor, directLink, stripcash, refresh }),
    [rows, status, settings, creativesFor, directLink, stripcash, refresh],
  );

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}

export function useAds(): AdsContextValue {
  const ctx = useContext(AdsContext);
  if (!ctx) throw new Error("useAds must be used within <AdsProvider>");
  return ctx;
}
