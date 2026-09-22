// view-buffer.ts — Redis write-coalescing for video views.
//
// Every play currently fires a synchronous Postgres RPC (increment_viewer_count)
// and a cache invalidation — a hot recording can generate 10s of thousands of
// tiny DB writes a day just refreshing counters. This module buffers that burst
// in Redis instead:
//
//   views:pend:v1:{id}   STRING  increments since the last PG flush
//   views:base:v1:{id}   STRING  the PG viewer count the buffer is anchored to
//   views:changed:v1     ZSET    recordings with drained-but-unflushed views
//
// POST /recordings/:id/view coalesces to INCR + ZADD (sub-millisecond, no DB)
// and replies with base + pending — which is EXACTLY what a cache layer would
// have served anyway. PG is only touched by the flush, which runs:
//   - on a cadence when self-hosted (server/index), 
//   - on the cache-warm cron (Vercel),
//   - eagerly via the admin flush endpoint, and
//   - automatically when a single recording's backlog crosses a threshold.
//
// The flush anchors on the LAST READ PG value with a compare-and-set filter
// so concurrent flushers (or direct legacy writes) never double-count or lose
// an increment. Fail-open: Redis down → recordView returns null and the route
// falls back to the existing direct-to-PG write path.

import { logger } from "./logger.js";
import { supabase } from "./supabase.js";
import { getRedis, isRedisConnected } from "./redis.js";
import { invalidateTags } from "../middleware/cache.js";
import { bumpRecordingHot, type HotBumpMeta } from "./hot-cache.js";

export const VIEWS_PREFIX = "views:";

const PEND_KEY = `${VIEWS_PREFIX}pend:v1:`;
const BASE_KEY = `${VIEWS_PREFIX}base:v1:`;
const CHANGED_SET = `${VIEWS_PREFIX}changed:v1`;
const AUTO_FLUSH_THRESHOLD = 10;
const FLUSH_CAP_PER_RUN = 500;

type RedisClient = ReturnType<typeof getRedis> & Record<string, any>;

function client(): RedisClient | null {
  const redis = getRedis();
  return redis && isRedisConnected() ? (redis as RedisClient) : null;
}

async function readPgViewers(id: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("recordings")
      .select("viewers")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return Number(data.viewers ?? 0);
  } catch {
    return null;
  }
}

/**
 * Compare-and-set the viewers column: only succeeds when PG still holds the
 * value we read. Returns the number of rows updated (0 → someone else moved it).
 */
async function casUpdateViewers(
  id: string,
  expected: number,
  target: number,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("recordings")
      .update({ viewers: target })
      .eq("id", id)
      .eq("viewers", expected)
      .select("id");
    if (error) {
      logger.error({ err: error, id }, "View buffer CAS update error");
      return 0;
    }
    return data?.length ?? 0;
  } catch (err) {
    logger.error({ err, id }, "View buffer CAS update threw");
    return 0;
  }
}

const metaLoaders = new Map<string, Promise<HotBumpMeta | null>>();

function loadRecordingMeta(id: string): Promise<HotBumpMeta | null> {
  const existing = metaLoaders.get(id);
  if (existing) return existing;
  const task = (async () => {
    try {
      const { data } = await supabase
        .from("recordings_with_links")
        .select("username, room_title, thumbnail_url, sprite_url")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      return {
        username: data.username ?? undefined,
        title: data.room_title ?? null,
        image_url: data.thumbnail_url || data.sprite_url || null,
      } satisfies HotBumpMeta;
    } catch {
      return null;
    }
  })();
  task.finally(() => metaLoaders.delete(id));
  metaLoaders.set(id, task);
  return task;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Coalesce one view into the Redis buffer. Returns the client-facing viewer
 * count (base + pending) or null when Redis is unavailable — the caller should
 * fall back to the direct-PG path.
 */
export async function recordView(recordingId: string): Promise<number | null> {
  const redis = client();
  if (!redis) return null;

  const pendKey = `${PEND_KEY}${recordingId}`;
  const baseKey = `${BASE_KEY}${recordingId}`;

  try {
    // Anchor the buffer to the current PG value ONCE (SETNX). Concurrent first
    // views race harmlessly: whoever wins set the same PG snapshot.
    await redis.setnx(baseKey, String(await readPgViewers(recordingId) ?? 0));

    const pending = await redis.incr(pendKey);
    await redis.zadd(CHANGED_SET, Date.now(), recordingId);

    // Trending feed — fire and forget; meta is only fetched once per recording.
    bumpRecordingHot(recordingId, () => loadRecordingMeta(recordingId)).catch(() => {});

    // Backlog crossed the threshold → flush this recording now (throttled) so a
    // viral video's counter stays near-live without hammering the DB per view.
    if (pending >= AUTO_FLUSH_THRESHOLD) {
      queueFlushId(recordingId);
    }

    const baseRaw = await redis.get(baseKey);
    const base = baseRaw === null ? 0 : Number.parseInt(baseRaw, 10) || 0;
    return base + pending;
  } catch (err) {
    logger.error({ err, recordingId }, "View buffer record error");
    return null;
  }
}

async function deleteBufferKeys(redis: RedisClient, recordingId: string): Promise<void> {
  await redis.del([`${PEND_KEY}${recordingId}`, `${BASE_KEY}${recordingId}`]);
  await redis.zrem(CHANGED_SET, recordingId);
}

/**
 * Flush ONE recording's backlog into PG. Returns a summary; never throws.
 */
async function flushId(redis: RedisClient, recordingId: string): Promise<{
  id: string;
  applied: number;
  casMiss: boolean;
  deleted: boolean;
}> {
  const pendKey = `${PEND_KEY}${recordingId}`;
  const baseKey = `${BASE_KEY}${recordingId}`;

  const pendingRaw = await redis.get(pendKey);
  const pending = pendingRaw === null ? 0 : Number.parseInt(pendingRaw, 10) || 0;
  if (pending <= 0) {
    await deleteBufferKeys(redis, recordingId);
    return { id: recordingId, applied: 0, casMiss: false, deleted: false };
  }

  const pg = await readPgViewers(recordingId);
  if (pg === null) {
    // Recording no longer exists — drop the whole buffer.
    await deleteBufferKeys(redis, recordingId);
    return { id: recordingId, applied: 0, casMiss: false, deleted: true };
  }

  // Resync the anchor if PG moved underneath us (direct legacy writes, bulk
  // scripts, or a peer flush).
  const baseRaw = await redis.get(baseKey);
  let base = baseRaw === null ? pg : (Number.parseInt(baseRaw, 10) || 0);
  if (base < pg) {
    base = pg;
    await redis.set(baseKey, String(pg));
  }

  const target = base + pending;
  const applied = Math.min(pending, Math.max(0, target - pg));
  if (applied <= 0) {
    await deleteBufferKeys(redis, recordingId);
    return { id: recordingId, applied: 0, casMiss: false, deleted: false };
  }

  const matched = await casUpdateViewers(recordingId, pg, pg + applied);
  if (matched <= 0) {
    // Another flusher (or a legacy writer) moved PG between our read and write.
    // Keep the backlog for the next pass and re-anchor to the now-current value.
    const fresh = await readPgViewers(recordingId);
    if (fresh !== null) await redis.set(baseKey, String(fresh));
    return { id: recordingId, applied: 0, casMiss: true, deleted: false };
  }

  // Success: drain the increments we applied, re-anchor, and (later) invalidate
  // cached responses so they repull the corrected count.
  const newPend = await redis.decrby(pendKey, applied);
  await redis.set(baseKey, String(pg + applied));
  if (Number(newPend) <= 0) {
    await redis.del(pendKey);
    await redis.zrem(CHANGED_SET, recordingId);
  }
  return { id: recordingId, applied, casMiss: false, deleted: false };
}

/** De-dupe auto-flush spawns so a correction loop can't stack up. */
const inflightAutoFlush = new Set<string>();

function queueFlushId(recordingId: string): void {
  if (inflightAutoFlush.has(recordingId)) return;
  inflightAutoFlush.add(recordingId);
  const redis = client();
  if (!redis) {
    inflightAutoFlush.delete(recordingId);
    return;
  }
  flushId(redis, recordingId)
    .then((result) => {
      if (result.applied > 0) {
        invalidateTags(["recordings", "stats"]).catch(() => {});
      }
    })
    .catch((err) => logger.error({ err, recordingId }, "Auto view-buffer flush failed"))
    .finally(() => inflightAutoFlush.delete(recordingId));
}

/**
 * Flush all recordings with a pending backlog, up to FLUSH_CAP_PER_RUN. Safe to
 * call from a cron job on a schedule; each rejected CAS is simply retried on the
 * next pass. Returns a summary for admin/metrics use.
 */
export async function flushPendingViews(): Promise<{
  scanned: number;
  applied: number;
  casMisses: number;
  deleted: number;
}> {
  const redis = client();
  if (!redis) {
    return { scanned: 0, applied: 0, casMisses: 0, deleted: 0 };
  }
  try {
    const ids = (await redis.zrange(CHANGED_SET, 0, FLUSH_CAP_PER_RUN - 1)) as string[];
    let applied = 0;
    let casMisses = 0;
    let deleted = 0;
    const harvested: string[] = [];

    for (const id of ids) {
      const result = await flushId(redis, id);
      applied += result.applied;
      if (result.casMiss) casMisses++;
      if (result.deleted) deleted++;
      // After a success we still may have premature invalidation below; batch it.
      harvested.push(id);
    }

    if (applied > 0) {
      invalidateTags(["recordings", "stats"]).catch(() => {});
    }
    return { scanned: ids.length, applied, casMisses, deleted };
  } catch (err) {
    logger.error({ err }, "View buffer batch flush error");
    return { scanned: 0, applied: 0, casMisses: 0, deleted: 0 };
  }
}

/** Admin/metrics: how many recordings still have buffered increments? */
export async function getViewBufferStats(): Promise<{
  pendingRecordings: number;
  enabled: boolean;
}> {
  const redis = client();
  if (!redis) return { pendingRecordings: 0, enabled: false };
  try {
    const count = await redis.zcard(CHANGED_SET);
    return { pendingRecordings: Number(count) || 0, enabled: true };
  } catch (err) {
    logger.warn({ err }, "View buffer stats failed");
    return { pendingRecordings: 0, enabled: false };
  }
}

/** Drop every buffered increment WITHOUT applying it (admin danger action). */
export async function clearViewBuffer(): Promise<number> {
  const redis = client();
  if (!redis) return 0;
  try {
    let deleted = 0;
    deleted += await redis.del(CHANGED_SET);
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "views:pend:v1:*", "COUNT", 500);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await redis.del(keys);
      }
    } while (cursor !== "0");
    cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${BASE_KEY}*`, "COUNT", 500);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await redis.del(keys);
      }
    } while (cursor !== "0");
    return deleted;
  } catch (err) {
    logger.warn({ err }, "View buffer clear failed");
    return 0;
  }
}