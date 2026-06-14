import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";

// In serverless environments (Vercel, AWS Lambda), the platform manages
// the HTTP server directly and routes requests through the handler exported
// by serverless-http. We skip starting our own server in that case.
const isServerless =
  process.env.VERCEL === "1" || process.env.AWS_LAMBDA_RUNTIME_API !== undefined;

if (!isServerless) {
  const { warmupCache } = await import("./lib/cache-warmup");
  const { runHealthCheck } = await import("./lib/health-check");

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
}
