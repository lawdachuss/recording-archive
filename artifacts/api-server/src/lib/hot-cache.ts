// hot-cache.ts — Redis-backed trending rankings.
//
// Serving "hot right now" from an aggregate SQL query on every page load is
// expensive, and the result rarely changes between requests. Instead this keeps
// two weightless structures in Redis that the POST /recordings/:id/view path
// bumps with every play:
//
//   hot:rec:v1   ZSET  recording id -> heat score (incremented per view)
//   hot:rec:v1:meta  HASH   recording id -> JSON { username, title, image_url }
//   hot:perf:v1  ZSET  performer username -> heat score
//   hot:perf:v1:meta  HASH  performer username -> JSON { image_url }
//
// Reads are then O(log N) — ZREVRANGE gives the ranking in one op and HMGET
// hydrates the payloads in a second. The ZSETs are sliding-window-ish: heat
// scores are monotonic deltas that decay only on periodic rebuilds, and the
// whole structure TTLs out (refreshed on each bump) if the site goes quiet.
//
// All functions FAIL OPEN: no Redis → bumps are no-ops and reads return empty
// arrays, so callers fall back to their existing DB path.

import { logger } from "./logger.js";
import { getRedis, isRedisConnected } from "./redis.js";

export const HOT_PREFIX = "hot:";

const RECS_SET = `${HOT_PREFIX}rec:v1`;
const RECS_META = `${HOT_PREFIX}rec:v1:meta`;
const PERFS_SET = `${HOT_PREFIX}perf:v1`;
const PERFS_META = `${HOT_PREFIX}perf:v1:meta`;
const HOT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days of quietude expires the sets

const RECORDING_TITLE_CAP = 120;

export interface HotRecording {
  id: string;
  username?: string;
  title?: string;
  image_url?: string | null;
  score: number;
}

export interface HotPerformer {
  username: string;
  image_url?: string | null;
  score: number;
}

export interface HotBumpMeta {
  username?: string;
  title?: string | null;
  image_url?: string | null;
}

type RedisClient = ReturnType<typeof getRedis> & Record<string, any>;

function client(): RedisClient | null {
  const redis = getRedis();
  return redis && isRedisConnected() ? (redis as RedisClient) : null;
}

/**
 * Record a play for `recordingId` and optionally attach/hydrate metadata.
 * `loadMeta` runs at most when the recording is NEW to the hot cache (or its
 * meta entry is missing) — so metadata is only ever fetched from the DB once
 * per recording, not once per view. Should be called fire-and-forget.
 */
export async function bumpRecordingHot(
  recordingId: string,
  loadMeta: () => Promise<HotBumpMeta | null>,
): Promise<void> {
  const redis = client();
  if (!redis) return;

  try {
    const hasMeta = await redis.hexists(RECS_META, recordingId);
    const existing = hasMeta ? (await redis.hget(RECS_META, recordingId)) : null;
    let meta: HotBumpMeta | null = null;
    if (existing) {
      try {
        meta = JSON.parse(existing) as HotBumpMeta;
      } catch {
        meta = null;
      }
    }

    const pipe = redis.pipeline();
    pipe.zincrby(RECS_SET, 1, recordingId);
    pipe.expire(RECS_SET, HOT_TTL_SECONDS);
    pipe.expire(RECS_META, HOT_TTL_SECONDS);

    if (!existing) {
      meta = (await loadMeta().catch(() => null)) ?? {};
      const image = meta?.image_url ?? null;
      pipe.hset(RECS_META, recordingId, JSON.stringify(meta));
      pipe.zincrby(PERFS_SET, 1, meta.username ?? "unknown");
      pipe.hset(PERFS_META, meta.username ?? "unknown", JSON.stringify({ image_url: image }));
      pipe.expire(PERFS_SET, HOT_TTL_SECONDS);
      pipe.expire(PERFS_META, HOT_TTL_SECONDS);
    } else if (meta?.username) {
      pipe.zincrby(PERFS_SET, 1, meta.username);
      pipe.expire(PERFS_SET, HOT_TTL_SECONDS);
      pipe.expire(PERFS_META, HOT_TTL_SECONDS);
    }

    await pipe.exec();
  } catch (err) {
    logger.warn({ err, recordingId }, "Hot cache bump failed");
  }
}

export async function getHotRecordings(limit: number): Promise<HotRecording[]> {
  const redis = client();
  if (!redis) return [];
  try {
    const n = Math.max(1, Math.min(100, Math.floor(limit)));
    const ranked = await redis.zrevrange(RECS_SET, 0, n - 1, "WITHSCORES" as any) as string[];
    if (!ranked || ranked.length === 0) return [];

    const ids: string[] = [];
    const scores = new Map<string, number>();
    for (let i = 0; i + 1 < ranked.length; i += 2) {
      const id = ranked[i] as string;
      ids.push(id);
      scores.set(id, Number(ranked[i + 1]) || 0);
    }
    const metas = await redis.hmget(RECS_META, ids);
    return metas.map((raw: string | null, i: number) => {
      const id = ids[i] as string;
      let meta: HotBumpMeta = {};
      if (raw) {
        try {
          meta = JSON.parse(raw) as HotBumpMeta;
        } catch { meta = {}; }
      }
      return {
        id,
        username: meta.username,
        title: meta.title ? truncate(meta.title, RECORDING_TITLE_CAP) : undefined,
        image_url: meta.image_url,
        score: scores.get(id) ?? 0,
      };
    });
  } catch (err) {
    logger.warn({ err }, "Hot recordings read failed");
    return [];
  }
}

export async function getHotPerformers(limit: number): Promise<HotPerformer[]> {
  const redis = client();
  if (!redis) return [];
  try {
    const n = Math.max(1, Math.min(100, Math.floor(limit)));
    const ranked = await redis.zrevrange(PERFS_SET, 0, n - 1, "WITHSCORES" as any) as string[];
    if (!ranked || ranked.length === 0) return [];

    const usernames: string[] = [];
    const scores = new Map<string, number>();
    for (let i = 0; i + 1 < ranked.length; i += 2) {
      const username = ranked[i] as string;
      usernames.push(username);
      scores.set(username, Number(ranked[i + 1]) || 0);
    }
    const metas = await redis.hmget(PERFS_META, usernames);
    return metas.map((raw: string | null, i: number) => {
      const username = usernames[i] as string;
      let image_url: string | null | undefined;
      if (raw) {
        try {
          image_url = (JSON.parse(raw) as { image_url?: string | null }).image_url;
        } catch { image_url = undefined; }
      }
      return { username, image_url, score: scores.get(username) ?? 0 };
    });
  } catch (err) {
    logger.warn({ err }, "Hot performers read failed");
    return [];
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}\u2026`;
}

/** Seed rankings from a bulk data pass (used by the suggestion-index builder). */
export async function seedHotCache(
  recordings: Array<{ id: string; username?: string; title?: string | null; image_url?: string | null; viewers?: number }>,
  performers: Array<{ username: string; image_url?: string | null; score?: number }>,
): Promise<void> {
  const redis = client();
  if (!redis) return;
  try {
    const pipe = redis.pipeline();
    if (recordings.length > 0) {
      for (const rec of recordings) {
        const score = Math.max(1, Math.floor(rec.viewers ?? 1));
        pipe.zadd(RECS_SET, score, rec.id);
        pipe.hset(RECS_META, rec.id, JSON.stringify({
          username: rec.username,
          title: rec.title ?? null,
          image_url: rec.image_url ?? null,
        }));
        if (rec.username) {
          pipe.zadd(PERFS_SET, score, rec.username);
          pipe.hset(PERFS_META, rec.username, JSON.stringify({ image_url: rec.image_url ?? null }));
        }
      }
    }
    if (performers.length > 0) {
      for (const perf of performers) {
        pipe.zadd(PERFS_SET, Math.max(1, Math.floor(perf.score ?? 1)), perf.username);
        pipe.hset(PERFS_META, perf.username, JSON.stringify({ image_url: perf.image_url ?? null }));
      }
    }
    if (recordings.length > 0 || performers.length > 0) {
      pipe.expire(RECS_SET, HOT_TTL_SECONDS);
      pipe.expire(RECS_META, HOT_TTL_SECONDS);
      pipe.expire(PERFS_SET, HOT_TTL_SECONDS);
      pipe.expire(PERFS_META, HOT_TTL_SECONDS);
    }
    await pipe.exec();
  } catch (err) {
    logger.warn({ err }, "Hot cache seed failed");
  }
}

/** Quick occupancy stats for cache-admin. */
export async function getHotStats(): Promise<{ recordings: number; performers: number }> {
  const redis = client();
  if (!redis) return { recordings: 0, performers: 0 };
  try {
    const [recordings, performers] = await Promise.all([
      redis.zcard(RECS_SET),
      redis.zcard(PERFS_SET),
    ]);
    return { recordings: Number(recordings) || 0, performers: Number(performers) || 0 };
  } catch (err) {
    logger.warn({ err }, "Hot cache stats failed");
    return { recordings: 0, performers: 0 };
  }
}

/** Clear all trending keys (admin purge). */
export async function clearHotCache(): Promise<number> {
  const redis = client();
  if (!redis) return 0;
  try {
    const keys = [RECS_SET, RECS_META, PERFS_SET, PERFS_META];
    return await redis.del(keys);
  } catch (err) {
    logger.warn({ err }, "Hot cache clear failed");
    return 0;
  }
}