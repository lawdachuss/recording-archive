import { Router } from "express";
import { warmupCache } from "../lib/cache-warmup.js";

/**
 * cache-warm.ts — scheduled cache warming for production.
 *
 * The boot-time warmup (index.ts) never runs on Vercel (the deployed entry
 * exports the app directly, no listen). This endpoint lets a Vercel Cron Job
 * prime the hot routes into Redis so real users never hit the expensive
 * aggregations (/api/performers, /api/stats, ...) on a cold cache.
 *
 * Protected by CRON_SECRET: when that env var is set, Vercel automatically
 * includes `Authorization: Bearer <CRON_SECRET>` on cron invocations. The
 * endpoint self-fetches through the public origin (there's no listening port
 * in a serverless function), which runs each route through the normal cache()
 * middleware — memory + Redis get populated exactly like a real request.
 *
 * purgeOnFailure is false: a flaky Redis/tunnel during a cron run must never
 * wipe the existing cache (the cache middleware's stale-while-revalidate
 * already serves stale data while refreshing).
 */

const router = Router();

router.get("/cache/warm", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: "warm endpoint not configured (CRON_SECRET missing)" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  if (!host) {
    res.status(400).json({ error: "could not determine host" });
    return;
  }

  const result = await warmupCache(`https://${host}`, { purgeOnFailure: false });
  res.json(result);
});

export default router;