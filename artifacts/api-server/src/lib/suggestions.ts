// suggestions.ts — Redis-backed search suggestion index.
//
// /api/search currently runs THREE live PostgREST queries per unique keystroke,
// one of which pages through the whole recordings table in search of a tag
// match. Typed queries are rarely repeated so the response cache can't help —
// every new prefix re-pays the DB.
//
// This module precomputes a compact snapshot of everything searchable into
// shared Redis:
//
//   sugg:v1:snapshot  STRING  JSON {
//                             performers: [{ label, image_url }]  // by count desc
//                             tags:       [string]                // by count desc
//                             recordings: [{ id, username, label, image_url }] // by recency
//                           }
//   sugg:v1:meta      STRING  JSON { builtAt, counts }
//
// /api/search then just filters an in-memory array of a few thousand entries for
// the typed prefix — no DB, sub-millisecond. The snapshot is rebuilt on a
// schedule (cache-warm cron), on admin demand, and lazily in the background the
// first time it's missing. Fail-open: no snapshot → callers keep their existing
// DB path.

import { logger } from "./logger.js";
import { supabase, fetchAll } from "./supabase.js";
import { getRedis, isRedisConnected } from "./redis.js";
import { seedHotCache } from "./hot-cache.js";

export const SUGGESTIONS_PREFIX = "sugg:v1:";

const SNAPSHOT_KEY = `${SUGGESTIONS_PREFIX}snapshot`;
const META_KEY = `${SUGGESTIONS_PREFIX}meta`;
const BUILD_LOCK = `${SUGGESTIONS_PREFIX}build-lock`;
const SNAPSHOT_TTL_SECONDS = 48 * 60 * 60;
const BUILD_LOCK_TTL_SECONDS = 120;

// Snapshot size caps: big enough to cover the long-tail of typed queries,
// small enough to filter in <5ms and fit comfortably in Redis/tunnel traffic.
const MAX_PERFORMERS = 1500;
const MAX_TAGS = 1500;
const MAX_RECORDINGS = 2000;

export interface SuggestionItem {
  type: "performer" | "recording" | "tag";
  label: string;
  subtitle?: string;
  image_url?: string | null;
  href: string;
}

export interface SuggestionSnapshot {
  builtAt: number;
  performers: Array<{ label: string; image_url?: string | null }>;
  tags: string[];
  recordings: Array<{
    id: string;
    username: string;
    haystack: string;
    label: string;
    image_url?: string | null;
  }>;
}

type RedisClient = ReturnType<typeof getRedis> & Record<string, any>;

function client(): RedisClient | null {
  const redis = getRedis();
  return redis && isRedisConnected() ? (redis as RedisClient) : null;
}

// ─── Snapshot builder ─────────────────────────────────────────────

interface PerfRow {
  username: string;
  thumbnail_url: string | null;
  sprite_url: string | null;
}

export async function buildSuggestionSnapshot(): Promise<{
  ok: boolean;
  performers: number;
  tags: number;
  recordings: number;
}> {
  const redis = client();
  try {
    // ── 1. Performers + tags in one streaming pass ────────────────────
    const byPerformer = new Map<string, { count: number; image: string | null }>();
    const tagCounts = new Map<string, number>();

    const { data: perfRows, error: perfError } = await fetchAll<PerfRow & { tags: string[] | null }>(
      (start, end) =>
        supabase
          .from("recordings_with_links")
          .select("username,tags,thumbnail_url,sprite_url")
          .not("links", "is", "null")
          .range(start, end),
    );
    if (perfError) throw perfError;

    for (const row of perfRows ?? []) {
      if (row.username) {
        const agg = byPerformer.get(row.username);
        if (agg) {
          agg.count++;
          if (!agg.image) agg.image = row.thumbnail_url || row.sprite_url || null;
        } else {
          byPerformer.set(row.username, {
            count: 1,
            image: row.thumbnail_url || row.sprite_url || null,
          });
        }
      }
      for (const tag of row.tags ?? []) {
        if (tag && tag !== "") {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }

    const performers = [...byPerformer.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, MAX_PERFORMERS)
      .map(([label, agg]) => ({ label, image_url: agg.image ?? null }));

    const tags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag)
      .slice(0, MAX_TAGS);

    // ── 2. Recent recordings (bounded, by recency) ─────────────────────
    let recordings: SuggestionSnapshot["recordings"] = [];
    const { data: recData, error: recError } = await supabase
      .from("recordings_with_links")
      .select("id,username,room_title,filename,thumbnail_url")
      .not("links", "is", "null")
      .order("timestamp", { ascending: false })
      .limit(MAX_RECORDINGS);
    if (recError) throw recError;

    recordings = (recData ?? []).map((r: { id?: string; username?: string; room_title?: string; filename?: string; thumbnail_url?: string | null } | null) => {
      const row = r ?? {};
      const rawTitle = row.room_title || row.filename;
      const title = rawTitle && rawTitle.length > 80 ? rawTitle.slice(0, 77) + "\u2026" : (rawTitle || "Untitled");
      return {
        id: row.id ?? "",
        username: row.username ?? "unknown",
        haystack: `${row.username ?? ""} ${row.room_title ?? ""} ${row.filename ?? ""}`.toLowerCase(),
        label: title,
        image_url: row.thumbnail_url ?? null,
      };
    });

    // ── 3. Persist to Redis ────────────────────────────────────────────
    const snapshot: SuggestionSnapshot = {
      builtAt: Date.now(),
      performers,
      tags,
      recordings,
    };
    const counts = { performers: performers.length, tags: tags.length, recordings: recordings.length };

    if (redis) {
      await redis.setex(SNAPSHOT_KEY, SNAPSHOT_TTL_SECONDS, JSON.stringify(snapshot));
      await redis.setex(META_KEY, SNAPSHOT_TTL_SECONDS, JSON.stringify({ builtAt: snapshot.builtAt, counts }));
      // Seed the trending leaderboards from the snapshot so the little "hot"
      // ZSETs boot quickly for a brand-new Redis (before real views fill them).
      await seedHotCache(
        (recData ?? []).slice(0, 200).map((r: any, i: number) => ({
          id: r.id,
          username: r.username,
          title: r.room_title ?? null,
          image_url: r.thumbnail_url ?? null,
          viewers: Math.max(1, 200 - i),
        })),
        performers.slice(0, 100).map((p, i) => ({
          username: p.label,
          image_url: p.image_url,
          score: 100 - i,
        })),
      );
    }

    logger.info({ counts }, "Search suggestion snapshot built");
    return { ok: true, ...counts };
  } catch (err) {
    logger.error({ err }, "Search suggestion snapshot build failed");
    return { ok: false, performers: 0, tags: 0, recordings: 0 };
  }
}

// ─── Read path with short-lived in-memory memo ─────────────────────

let snapshotMemo: { at: number; value: SuggestionSnapshot | null } = {
  at: 0,
  value: null,
};
const MEMO_TTL_MS = 30_000;

export async function getSuggestionSnapshot(): Promise<SuggestionSnapshot | null> {
  if (snapshotMemo.value && Date.now() - snapshotMemo.at < MEMO_TTL_MS) {
    return snapshotMemo.value;
  }
  const redis = client();
  let snapshot: SuggestionSnapshot | null = null;
  if (redis) {
    try {
      const raw = await redis.get(SNAPSHOT_KEY);
      if (typeof raw === "string" && raw.length > 0) {
        snapshot = JSON.parse(raw) as SuggestionSnapshot;
      }
    } catch (err) {
      logger.warn({ err }, "Suggestion snapshot read failed");
    }
  }
  snapshotMemo = { at: Date.now(), value: snapshot };
  return snapshot;
}

// ─── Background build (stamped)-guarded so a herd of misses builds once ──────

let buildingNow = false;

export async function maybeBuildSuggestionSnapshot(): Promise<void> {
  if (buildingNow) return;
  const redis = client();
  if (redis) {
    try {
      const lock = await redis.set(BUILD_LOCK, "1", "EX", BUILD_LOCK_TTL_SECONDS, "NX");
      if (lock !== "OK") return; // another instance is building
    } catch {
      // lock check failed — fall through, only build if nothing cached
      const existing = await getSuggestionSnapshot();
      if (existing) return;
    }
  }
  buildingNow = true;
  try {
    await buildSuggestionSnapshot();
  } finally {
    buildingNow = false;
  }
}

// ─── Matching ──────────────────────────────────────────────────────

const PERF_CAP = 4;
const REC_CAP = 4;
const TAG_CAP = 4;

/** Substring-match the typed query against the snapshot, mirroring /api/search shapes. */
export function matchSuggestions(rawQuery: string, snapshot: SuggestionSnapshot): SuggestionItem[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 2) return [];

  const out: SuggestionItem[] = [];
  let perfCount = 0;
  let recCount = 0;
  let tagCount = 0;

  for (const p of snapshot.performers) {
    if (p.label.toLowerCase().includes(q)) {
      out.push({
        type: "performer",
        label: p.label,
        subtitle: "Performer",
        image_url: p.image_url,
        href: `/performers/${encodeURIComponent(p.label)}`,
      });
      if (++perfCount >= PERF_CAP) break;
    }
  }

  for (const r of snapshot.recordings) {
    if (r.haystack.includes(q)) {
      out.push({
        type: "recording",
        label: r.label,
        subtitle: r.username,
        image_url: r.image_url,
        href: `/video/${r.id}`,
      });
      if (++recCount >= REC_CAP) break;
    }
  }

  for (const tag of snapshot.tags) {
    if (tag.toLowerCase().includes(q)) {
      out.push({
        type: "tag",
        label: tag,
        subtitle: "Tag",
        href: `/browse?tags=${encodeURIComponent(tag)}`,
      });
      if (++tagCount >= TAG_CAP) break;
    }
  }

  return out;
}

// ─── Admin / stats ─────────────────────────────────────────────────

export async function getSuggestionStats(): Promise<{
  counts: { performers: number; tags: number; recordings: number };
  builtAt: number | null;
}> {
  const empty = { counts: { performers: 0, tags: 0, recordings: 0 }, builtAt: null };
  const redis = client();
  if (!redis) return empty;
  try {
    const [snapshotRaw, metaRaw] = await Promise.all([redis.get(SNAPSHOT_KEY), redis.get(META_KEY)]);
    const snapshot = snapshotRaw ? (JSON.parse(snapshotRaw) as SuggestionSnapshot) : null;
    let builtAt: number | null = null;
    if (metaRaw) {
      try {
        builtAt = (JSON.parse(metaRaw) as { builtAt: number }).builtAt ?? null;
      } catch { builtAt = null; }
    }
    return {
      counts: {
        performers: snapshot?.performers.length ?? 0,
        tags: snapshot?.tags.length ?? 0,
        recordings: snapshot?.recordings.length ?? 0,
      },
      builtAt,
    };
  } catch (err) {
    logger.warn({ err }, "Suggestion stats failed");
    return empty;
  }
}