import "dotenv/config";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { warmupCache } from "./lib/cache-warmup.js";
import { runHealthCheck } from "./lib/health-check.js";
import { initInvalidationPubSub } from "./middleware/cache.js";
import { flushPendingViews } from "./lib/view-buffer.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

    // Cross-instance cache invalidation: subscribe so writes handled by OTHER
    // instances (or a different serverless cold-warm lambda) clear our memory
    // cache too. Long-lived self-hosted servers keep this subscription alive.
    initInvalidationPubSub();

    // Drain any Redis-buffered view counts left over from a previous run.
    flushPendingViews().catch((err) => {
      logger.error({ err }, "Boot-time view buffer flush failed");
    });

    // Self-hosted cadence: coalesced view counts hit Postgres in a batch every
    // minute instead of once per play. unref so the timer never keeps the
    // process alive by itself.
    const flushTimer = setInterval(() => {
      flushPendingViews().catch((err) => {
        logger.error({ err }, "Scheduled view buffer flush failed");
      });
    }, 60_000);
    flushTimer.unref?.();

    // Fire cache warmup in the background — never blocks the server
    warmupCache(`http://127.0.0.1:${port}`).catch((err) => {
      logger.error({ err }, "Cache warmup failed unexpectedly");
    });

    // Run startup health check — pings each major API endpoint
    runHealthCheck(port).catch((err) => {
      logger.error({ err }, "Health check failed unexpectedly");
    });
});
