import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cache-Control is managed per-route by the cache() middleware.
// This ensures Redis caching and browser caching work together properly.

app.use("/api", router);

// ─── Global error handler ──────────────────────────────
// Catches unhandled promise rejections from async route handlers
// so the server returns a clean 500 instead of crashing silently.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled route error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
