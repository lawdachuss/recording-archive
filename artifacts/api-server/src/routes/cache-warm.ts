import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { warmupCache } from "../lib/cache-warmup.js";
import { flushPendingViews } from "../lib/view-buffer.js";
import { maybeBuildSuggestionSnapshot } from "../lib/suggestions.js";

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
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(String(req.headers.authorization ?? ""), "utf8");
  const matches =
    expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!matches) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // Warm through a fixed, trusted origin — never a spoofable x-forwarded-host
  // (an attacker supplying that header could make the server funnel its
  // warm-up fetches at an arbitrary host, amplifying their traffic).
  let origin = (process.env.CRON_PUBLIC_URL ?? "https://chuglii.in").trim();
  if (!/^https?:\/\//i.test(origin)) origin = "https://chuglii.in";

  const result = await warmupCache(origin, { purgeOnFailure: false });

  // Co-located maintenance on the daily cron: drain buffered view counters into
  // Postgres and (re)build the search suggestion index if it's stale/missing.
  const [viewsResult, suggestionsResult] = await Promise.allSettled([
    flushPendingViews(),
    maybeBuildSuggestionSnapshot(),
  ]);
  const viewsFlushed =
    viewsResult.status === "fulfilled" ? viewsResult.value : { error: String(viewsResult.reason) };
  const suggestions =
    suggestionsResult.status === "fulfilled"
      ? { okay: true }
      : { okay: false, error: String(suggestionsResult.reason) };

  res.json({
    ...result,
    maintenance: { viewsFlushed, suggestions },
  });
});

export default router;