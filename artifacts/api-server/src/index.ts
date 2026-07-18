import "dotenv/config";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { warmupCache } from "./lib/cache-warmup.js";
import { runHealthCheck } from "./lib/health-check.js";

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

    // Fire cache warmup in the background — never blocks the server
    warmupCache(port).catch((err) => {
      logger.error({ err }, "Cache warmup failed unexpectedly");
    });

    // Run startup health check — pings each major API endpoint
    runHealthCheck(port).catch((err) => {
      logger.error({ err }, "Health check failed unexpectedly");
    });
});
