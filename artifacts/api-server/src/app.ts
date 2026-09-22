import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { globalRateLimiter, rateLimit } from "./middleware/rate-limit.js";
import { logger } from "./lib/logger.js";

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

// ─── CORS ─────────────────────────────────────────────────────────
// Allowlist only our own frontends instead of reflecting any origin.
// Requests from unknown origins get no CORS headers (same-origin policy
// still applies — their JS cannot read responses).
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/([\w-]+\.)*chuglii\.in$/,
  /^https:\/\/.+\.vercel\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / non-browser requests
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  }),
);
// Rate limiting: per-IP global limiter with a stricter budget for writes.
// Runs BEFORE the body parsers so spammy/oversized requests are rejected at
// the window check instead of paying for express.json()/urlencoded() to
// buffer and parse up to 1MB per request first.
app.use("/api", globalRateLimiter);

// Writes get a tighter bucket than reads (comments, reactions, views,
// saved/history mutations, ...).
const writeLimiter = rateLimit({ bucket: "write" });
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    writeLimiter(req, res, next);
    return;
  }
  next();
});

// Stripe webhooks must see the raw body for HMAC signature verification, so
// the parser is mounted BEFORE express.json()/urlencoded() which would consume
// the stream. The route then reads req.body as a Buffer.
app.use("/api/premium/webhook", express.raw({ type: "*/*", limit: "1mb" }));
// 1mb JSON body limit (default is 100kb): comment/reaction bodies and admin
// actions can exceed 100KB on dense payloads.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Cache-Control is managed per-route by the cache() middleware.
// This ensures Redis caching and browser caching work together properly.

app.use("/api", router);

// ─── Global error handler ──────────────────────────────────────
// Catches unhandled promise rejections from async route handlers
// so the server returns a clean 500 instead of crashing silently.
// Body-parser failures (bad JSON, oversized payload) carry a 4xx status —
// return those at face value instead of masking them as 500s.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    logger.warn({ err }, "Bad request rejected");
    if (res.headersSent) return;
    res.status(status).json({ error: "Bad request" });
    return;
  }
  logger.error({ err }, "Unhandled route error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
