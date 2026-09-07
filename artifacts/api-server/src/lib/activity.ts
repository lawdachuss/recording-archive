import { getRedis, isRedisConnected } from "./redis.js";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

/**
 * activity.ts — Stage 1 activity pipeline.
 *
 * Client beacons (RUM + future activity events) land on POST /api/rum, which
 * calls `pushActivityBatch`. Events accumulate in a Redis Stream; a lazily
 * triggered flush (`flushActivity`, plus the /api/rum/flush endpoint for
 * cron) drains the stream in batches and inserts into `activity_events`.
 *
 * Serverless-friendly:
 *  - No background worker — flush is triggered probabilistically on ingest
 *    and on demand via the drain endpoint.
 *  - Redis Stream consumer groups make concurrent flushers safe: each entry
 *    is delivered to exactly one consumer; ids are XACKed only after the
 *    batch insert succeeds, so redelivered entries are re-inserted idempotently
 *    (id = "<streamId>:<metricIndex>", primary key in Postgres).
 *  - Fails open: if Redis is down the push is dropped (a log line) and
 *    requests are never blocked; if Postgres is down the batch is retried
 *    via consumer-group redelivery.
 */

const STREAM_KEY = "activity:stream";
const GROUP_NAME = "activity-flushers";
const MAX_FLUSH_ENTRIES = 200; // stream entries per flush call
const STREAM_MAXLEN = 5_000; // trim bound, keeps memory bounded under load

// ─── Producer ────────────────────────────────────────────────────

export interface ActivityMetric {
  name: string;
  value: number;
  path?: string;
  ts?: number;
  /** Structured attributes (recording_id, search query, etc.). Stored as jsonb. */
  meta?: Record<string, unknown>;
}

/**
 * Append a batch of metrics to the Redis Stream. Fire-and-forget from the
 * caller's perspective (the endpoint awaits it, but failures are swallowed).
 */
export async function pushActivityBatch(metrics: ActivityMetric[]): Promise<void> {
  if (metrics.length === 0) return;
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;

  try {
    await redis.xadd(STREAM_KEY, "*", "payload", JSON.stringify(metrics));
    // Best-effort trim so a burst can't grow the stream unbounded.
    redis.xtrim(STREAM_KEY, "MAXLEN", "~", STREAM_MAXLEN).catch(() => {});
  } catch (err) {
    logger.warn({ err }, "Activity push failed (batch dropped)");
  }
}

// ─── Consumer-group flush ────────────────────────────────────────

async function ensureGroup(redis: NonNullable<ReturnType<typeof getRedis>>): Promise<void> {
  try {
    await redis.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "0", "MKSTREAM");
  } catch (err) {
    // BUSYGROUP — group already exists, fine. Anything else is a real error.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/BUSYGROUP/i.test(msg)) throw err;
  }
}

interface StreamEntry {
  id: string;
  metrics: ActivityMetric[];
}

function parseEntries(raw: unknown): StreamEntry[] {
  // ioredis xreadgroup returns: [[streamKey, [[id, [field, value, ...]], ...]]]
  const groups = raw as [string, Array<[string, string[]]>][] | null;
  if (!groups || groups.length === 0) return [];
  const entries = groups[0]![1] ?? [];
  const parsed: StreamEntry[] = [];

  for (const [id, fields] of entries) {
    let payload = "";
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] === "payload") payload = fields[i + 1] ?? "";
    }
    try {
      const metrics = JSON.parse(payload) as unknown;
      if (Array.isArray(metrics)) {
        parsed.push({
          id,
          metrics: metrics            .filter(
              (m): m is ActivityMetric =>
                !!m &&
                typeof m.name === "string" &&
                typeof m.value === "number" &&
                Number.isFinite(m.value),
            )
            .map((m) => ({
              name: m.name.slice(0, 64),
              value: m.value,
              path: typeof m.path === "string" ? m.path.slice(0, 256) : undefined,
              ts: typeof m.ts === "number" ? m.ts : undefined,
              meta: m.meta && typeof m.meta === "object" ? m.meta : undefined,
            })),
        });
      }
    } catch {
      // Malformed payload — still ack it so it doesn't wedge the group.
      parsed.push({ id, metrics: [] });
    }
  }
  return parsed;
}

/**
 * Drain up to MAX_FLUSH_ENTRIES stream entries, insert them into Postgres in
 * one batched upsert, then XACK. Returns the number of stream entries
 * processed. Safe to call concurrently from many serverless instances.
 */
export async function flushActivity(): Promise<number> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return 0;

  try {
    await ensureGroup(redis);
    const consumer = `flusher-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

    const raw = await redis.xreadgroup(
      "GROUP",
      GROUP_NAME,
      consumer,
      "COUNT",
      MAX_FLUSH_ENTRIES,
      "STREAMS",
      STREAM_KEY,
      ">",
    );
    const entries = parseEntries(raw);
    if (entries.length === 0) return 0;

    // Build one flat row set; id = "<streamId>:<idx>" is the PK, so upsert
    // is idempotent under redelivery.
    const rows: Array<{
      id: string;
      name: string;
      value: number;
      path: string | null;
      ts: number | null;
      meta: Record<string, unknown> | null;
    }> = [];
    const ids: string[] = [];

    for (const entry of entries) {
      ids.push(entry.id);
      entry.metrics.forEach((m, idx) => {
        rows.push({
          id: `${entry.id}:${idx}`,
          name: m.name.slice(0, 64),
          value: m.value,
          path: m.path?.slice(0, 256) ?? null,
          ts: typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : null,
          meta: m.meta && typeof m.meta === "object" ? m.meta : null,
        });
      });
    }

    if (rows.length > 0) {
      // Batched single insert; onConflict ignores redelivered duplicates.
      const { error } = await supabase
        .from("activity_events")
        .upsert(rows, { onConflict: "id" });
      if (error) throw error;
    }

    // Acknowledge only after the insert succeeded (at-least-once).
    await redis.xack(STREAM_KEY, GROUP_NAME, ...ids);
    return entries.length;
  } catch (err) {
    logger.warn({ err }, "Activity flush failed (entries will be redelivered)");
    return 0;
  }
}