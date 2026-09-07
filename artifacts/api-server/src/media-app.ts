import express, { type Express } from "express";
import pinoHttp from "pino-http";
import mediaProxyRouter from "./routes/media-proxy.js";
import { logger } from "./lib/logger.js";

/**
 * media-app.ts — Express app containing ONLY the media proxy.
 *
 * Deployed as its own Vercel serverless function (api/media.mjs) so that
 * CPU/memory-heavy image resizing and long-running video streams never
 * share a concurrency pool with the JSON API. Same middleware posture as
 * app.ts (logging + permissive CORS); caching is handled inside the route
 * itself via Cache-Control headers, and rate limiting is applied at the
 * edge/WAF layer for this function.
 */
const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Permissive CORS: this endpoint serves images/videos to the SPA origin and
// is also hit directly by <img>/<video> tags.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(mediaProxyRouter);

// Global error handler — same contract as app.ts.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled media-proxy error");
  if (res.headersSent) return;
  res.status(500).end();
});

export default app;
