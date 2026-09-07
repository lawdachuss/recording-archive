import { Router } from "express";

/**
 * rum.ts — fire-and-forget ingest for Real User Monitoring beacons.
 *
 * POST /api/rum  { metrics: [{ name, value, path, ts }] }
 *
 * Design: this endpoint must NEVER slow the site or fail loudly.
 * - No DB writes, no cache interaction — one log line per batch (10% session
 *   sampling + 5s client-side batching keep volume low). Vercel log drains
 *   make this queryable; Stage 1 of the scaling plan replaces the log with
 *   the activity/event pipeline (Redis Streams → ClickHouse). The client
 *   contract (batched JSON array) is designed to survive that unchanged.
 * - Malformed payloads still get 204 so clients never retry.
 * - The global rate limiter already applies.
 */
const router = Router();

interface RumMetric {
  name?: unknown;
  value?: unknown;
  path?: unknown;
  ts?: unknown;
}

router.post("/rum", (req, res) => {
  try {
    const body = req.body as { metrics?: RumMetric[] } | undefined;
    const metrics = Array.isArray(body?.metrics) ? body!.metrics!.slice(0, 50) : [];

    if (metrics.length > 0) {
      req.log?.info?.(
        {
          rum: true,
          count: metrics.length,
          metrics: metrics.map((m) => ({
            name: typeof m.name === "string" ? m.name.slice(0, 32) : "unknown",
            value: typeof m.value === "number" && Number.isFinite(m.value) ? m.value : -1,
            path: typeof m.path === "string" ? m.path.slice(0, 128) : "/",
            ts: typeof m.ts === "number" ? m.ts : 0,
          })),
        },
        "RUM batch",
      );
    }
  } catch {
    /* never fail a beacon */
  }
  res.status(204).end();
});

export default router;
