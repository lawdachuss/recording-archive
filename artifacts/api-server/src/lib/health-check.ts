import { logger } from "./logger";

// ─── Configuration ─────────────────────────────────────────────────
// Ordered by criticality. The health check runs these in parallel
// for speed, but the summary groups them logically.
interface EndpointCheck {
  label: string;
  path: string;
  /** Expected status range (default: 200-299) */
  expectOk?: (status: number) => boolean;
}

const ENDPOINTS: EndpointCheck[] = [
  // Core API — must work for the app to function
  { label: "Health", path: "/api/healthz" },
  { label: "Stats", path: "/api/stats" },
  { label: "Tags", path: "/api/tags" },
  { label: "Performers", path: "/api/performers" },
  { label: "Recordings (recent)", path: "/api/recordings?limit=1&sort=newest" },

  // Search — lower criticality, but nice to verify
  { label: "Search (empty)", path: "/api/search?q=" },
  { label: "Search (valid)", path: "/api/search?q=test" },
];

// ─── Result type ───────────────────────────────────────────────────

export interface EndpointResult {
  label: string;
  path: string;
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

export interface HealthCheckResult {
  total: number;
  ok: number;
  failed: number;
  durationMs: number;
  endpoints: EndpointResult[];
}

// ─── Health check runner ───────────────────────────────────────────

/**
 * Ping each major API endpoint on the running server and log
 * the results. Useful to confirm the server is healthy after
 * startup, especially when code changes affect database queries.
 *
 * Call this after `app.listen()`:
 *
 *   app.listen(port, () => {
 *     runHealthCheck(port).catch(() => {});
 *   });
 *
 * It runs entirely in the background — errors are logged but
 * never crash the server.
 */
export async function runHealthCheck(port: number): Promise<HealthCheckResult> {
  const start = Date.now();
  const baseUrl = `http://127.0.0.1:${port}`;
  const results: EndpointResult[] = [];

  // Fire all checks in parallel for speed
  const checks = ENDPOINTS.map(async (endpoint) => {
    const checkStart = Date.now();
    const url = `${baseUrl}${endpoint.path}`;
    const expectOk = endpoint.expectOk ?? ((s: number) => s >= 200 && s < 300);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      const ok = expectOk(response.status);
      const durationMs = Date.now() - checkStart;

      // Log each endpoint individually
      if (ok) {
        logger.info(
          { label: endpoint.label, status: response.status, durationMs, path: endpoint.path },
          `Health check ✓ ${endpoint.label}`,
        );
      } else {
        // Try to get the error body for context
        let bodyText = "";
        try { bodyText = await response.text(); } catch { /* ignore */ }
        logger.error(
          {
            label: endpoint.label,
            status: response.status,
            durationMs,
            path: endpoint.path,
            body: bodyText.slice(0, 500),
          },
          `Health check ✗ ${endpoint.label}`,
        );
      }

      results.push({ label: endpoint.label, path: endpoint.path, ok, status: response.status, durationMs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - checkStart;

      logger.error(
        { label: endpoint.label, error: message, durationMs, path: endpoint.path },
        `Health check ✗ ${endpoint.label} — request failed`,
      );

      results.push({
        label: endpoint.label,
        path: endpoint.path,
        ok: false,
        status: 0,
        durationMs,
        error: message,
      });
    }
  });

  await Promise.allSettled(checks);

  const durationMs = Date.now() - start;
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const okPercent = results.length > 0 ? Math.round((ok / results.length) * 100) : 0;

  // ── Summary ──────────────────────────────────────────────────────
  if (failed === 0) {
    logger.info(
      { total: results.length, durationMs },
      `Health check passed — all ${results.length} endpoints responded successfully`,
    );
  } else if (ok === 0) {
    logger.error(
      { total: results.length, failed, durationMs },
      `Health check failed — all ${results.length} endpoints returned errors`,
    );
  } else {
    logger.warn(
      { ok, failed, total: results.length, okPercent, durationMs },
      `Health check completed with ${failed} failure(s) — ${okPercent}% of endpoints healthy`,
    );
  }

  return { total: results.length, ok, failed, durationMs, endpoints: results };
}
