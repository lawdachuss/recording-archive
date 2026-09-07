/**
 * rum.ts — real-user monitoring + activity tracking, zero dependencies.
 *
 * One shared batched beacon pipeline:
 *   - `trackActivity(name, { value, meta })` — structured events (page views,
 *     recording views, searches). Sent fire-and-forget via sendBeacon, so
 *     they never block navigation.
 *   - Core Web Vitals (LCP, INP proxy, CLS) + a resource-timing summary are
 *     collected on top, 10% session-sampled to keep ingest proportional.
 *
 * Everything ships to POST /api/rum, which routes into the Redis Stream →
 * batched Postgres pipeline (Stage 1). Every failure is swallowed — this
 * layer must never break the page.
 */

const ENDPOINT = "/api/rum";

export interface ActivityMeta {
  [key: string]: string | number | boolean | null;
}

export interface TrackOptions {
  /** Numeric payload (defaults to 1). */
  value?: number;
  /** Structured attributes stored as jsonb (e.g. { recording_id }). */
  meta?: ActivityMeta;
}

interface RumMetric {
  name: string;
  value: number;
  path: string;
  ts: number;
  meta?: ActivityMeta;
}

const queue: RumMetric[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sessionSampled: boolean | null = null;

/** Sample 10% of sessions to keep RUM (CWV) volume proportional. */
function isSampled(): boolean {
  if (sessionSampled === null) {
    try {
      sessionSampled = Math.random() < 0.1;
    } catch {
      sessionSampled = false;
    }
  }
  return sessionSampled;
}

function currentPath(): string {
  try {
    return location.pathname;
  } catch {
    return "/";
  }
}

function enqueue(metric: RumMetric): void {
  queue.push(metric);
  if (queue.length >= 10) {
    flush();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, 5_000);
  }
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);

  try {
    const payload = JSON.stringify({ metrics: batch });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
    } else {
      fetch(ENDPOINT, {
        method: "POST",
        body: payload,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    }
  } catch {
    /* never let tracking break the page */
  }
}

/**
 * Track a structured activity event. Unsampled (unlike CWV metrics) — views,
 * searches and navigation are lower-volume and worth capturing fully.
 */
export function trackActivity(name: string, options: TrackOptions = {}): void {
  if (typeof window === "undefined") return;
  if (!import.meta.env.PROD) return; // never track in dev
  if (!name || name.length === 0) return;

  enqueue({
    name: name.slice(0, 64),
    value: typeof options.value === "number" && Number.isFinite(options.value) ? options.value : 1,
    path: currentPath(),
    ts: Date.now(),
    ...(options.meta && Object.keys(options.meta).length > 0 ? { meta: options.meta } : {}),
  });
}

// ─── Core Web Vitals (10% session-sampled) ───────────────────────

/** Largest Contentful Paint. */
function observeLcp(): void {
  try {
    type LcpEntry = PerformanceEntry & { renderTime: number; startTime: number };
    let last = 0;
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries() as LcpEntry[];
      for (const e of entries) last = Math.max(last, e.startTime || e.renderTime);
    });
    po.observe({ type: "largest-contentful-paint", buffered: true } as PerformanceObserverInit);
    addEventListener("pagehide", () => {
      if (last > 0) enqueue({ name: "lcp", value: Math.round(last), path: currentPath(), ts: Date.now() });
      po.disconnect();
    }, { once: true });
  } catch {
    /* unsupported */
  }
}

/** Cumulative Layout Shift. */
function observeCls(): void {
  try {
    type ClsEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };
    let cls = 0;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as ClsEntry[]) {
        if (!e.hadRecentInput) cls += e.value;
      }
    });
    po.observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
    addEventListener("pagehide", () => {
      if (cls > 0) enqueue({ name: "cls", value: Math.round(cls * 1000) / 1000, path: currentPath(), ts: Date.now() });
      po.disconnect();
    }, { once: true });
  } catch {
    /* unsupported */
  }
}

/** Interaction to Next Paint proxy: worst event duration seen. */
function observeInpProxy(): void {
  try {
    type EventEntry = PerformanceEntry & { interactionId?: number };
    let worst = 0;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as EventEntry[]) {
        if (e.duration > worst) worst = e.duration;
      }
    });
    po.observe({ type: "event", durationThreshold: 100, buffered: true } as PerformanceObserverInit);
    addEventListener("pagehide", () => {
      if (worst > 0) enqueue({ name: "inp_proxy", value: Math.round(worst), path: currentPath(), ts: Date.now() });
      po.disconnect();
    }, { once: true });
  } catch {
    /* unsupported */
  }
}

/**
 * Resource-timing summary every 30s: count + total transfer size of network
 * requests, so we can see client-side bandwidth patterns in aggregate.
 */
function observeResources(): void {
  try {
    setInterval(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      if (entries.length === 0) return;
      let bytes = 0;
      let count = 0;
      for (const e of entries) {
        if (e.transferSize > 0) {
          bytes += e.transferSize;
          count += 1;
        }
      }
      if (count > 0) {
        enqueue({ name: "resources", value: count, path: currentPath(), ts: Date.now() });
        enqueue({ name: "resource_bytes", value: bytes, path: currentPath(), ts: Date.now() });
        performance.clearResourceTimings();
      }
    }, 30_000);
  } catch {
    /* unsupported */
  }
}

export function initRum(): void {
  if (typeof window === "undefined") return;
  if (!import.meta.env.PROD) return;

  // CWV metrics are session-sampled (10%); activity events are not.
  if (isSampled()) {
    observeLcp();
    observeCls();
    observeInpProxy();
  }
  observeResources();

  // Final flush on unload.
  addEventListener("pagehide", flush, { once: true });
}