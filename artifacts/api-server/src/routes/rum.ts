import { Router } from "express";
import { pushActivityBatch, flushActivity, type ActivityMetric } from "../lib/activity.js";

/**
 * rum.ts — fire-and-forget ingest for Real User Monitoring + activity events.
 *
 * POST /api/rum   { metrics: [{ name, value, path, ts }] }
 * GET  /api/rum/flush   (cron / admin): drain the stream into Postgres now.
 *
 * Design:
 *  - The ingest endpoint is on the critical path of the browser beacon, so it
 *    must be fast and must never fail the request. The Redis XADD is awaited
 *    (bounded by Redis command timeout) but failures are swallowed.
 *  - A small probability of every ingest triggers a background lazy flush, so
 *    data reaches Postgres continuously even with no worker. The explicit
 *    flush endpoint backs that up (wire it to a Vercel cron on Pro; on Hobby
 *    cron is daily, so lazy flush is the primary mechanism).
 *  - The global rate limiter already applies to both endpoints.
 */
const router = Router();

const FLUSH_PROBABILITY = Number.parseFloat(process.env.ACTIVITY_FLUSH_PROBABILITY ?? "0.05") || 0.05;

const MAX_METRICS_PER_BATCH = 50;

function normalizeMeta(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const meta: Record<string, unknown> = {};
  // Cap meta at 8 keys, each value JSON-stringified and length-bounded, so a
  // bad client can't stuff the stream/DB with junk.
  for (const [key, value] of Object.entries(obj).slice(0, 8)) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized.length <= 256) meta[key.slice(0, 32)] = value;
    } catch {
      /* skip unserializable values */
    }
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function normalizeMetrics(body: unknown): ActivityMetric[] {
  const raw = (body as { metrics?: unknown })?.metrics;
  if (!Array.isArray(raw)) return [];

  const out: ActivityMetric[] = [];
  for (const m of raw.slice(0, MAX_METRICS_PER_BATCH)) {
    if (typeof m !== "object" || m === null) continue;
    const metric = m as Partial<ActivityMetric>;
    if (
      typeof metric.name === "string" &&
      typeof metric.value === "number" &&
      Number.isFinite(metric.value)
    ) {
      out.push({
        name: metric.name.slice(0, 64),
        value: metric.value,
        path: typeof metric.path === "string" ? metric.path.slice(0, 256) : undefined,
        ts: typeof metric.ts === "number" ? metric.ts : undefined,
        meta: normalizeMeta(metric.meta),
      });
    }
  }
  return out;
}

router.post("/rum", async (req, res) => {
  try {
    const metrics = normalizeMetrics(req.body);
    if (metrics.length > 0) {
      await pushActivityBatch(metrics);
      // Probabilistic lazy flush — no worker on serverless, so the stream is
      // drained continuously by a fraction of the ingest traffic itself.
      if (Math.random() < FLUSH_PROBABILITY) {
        flushActivity().catch(() => {});
      }
    }
  } catch {
    /* never fail a beacon */
  }
  res.status(204).end();
});

router.get("/rum/flush", async (_req, res) => {
  const processed = await flushActivity();
  res.json({ ok: true, processed });
});

export default router;