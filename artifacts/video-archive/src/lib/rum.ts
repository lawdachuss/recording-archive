/**
 * rum.ts — Real-user monitoring, zero dependencies.
 *
 * Collects Core Web Vitals (LCP, INP via event timing, CLS) plus a periodic
 * resource-timing summary, and ships them to the API with `navigator.sendBeacon`
 * so reporting never blocks navigation. Best-effort: every failure is swallowed.
 *
 * The ingest endpoint is fire-and-forget on the server side (see routes/rum.ts)
 * — this data must never slow the site down or break anything if it fails.
 */

const ENDPOINT = "/api/rum";

interface RumMetric {
  name: string;
  value: number;
  rating?: string;
  path: string;
  ts: number;
}

const queue: RumMetric[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sessionSampled: boolean | null = null;

/** Sample 10% of sessions to keep ingest volume proportional, not per-pageload. */
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
  if (!isSampled()) return;
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
    /* never let RUM break the page */
  }
}

// ─── Core Web Vitals (minimal inline implementations) ─────────────

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
        // clearResourceTimings keeps the buffer from growing unbounded on
        // long sessions; metrics for the interval are already captured.
        performance.clearResourceTimings();
      }
    }, 30_000);
  } catch {
    /* unsupported */
  }
}

export function initRum(): void {
  if (typeof window === "undefined") return;
  // Never run in dev.
  if (!import.meta.env.PROD) return;
  observeLcp();
  observeCls();
  observeInpProxy();
  observeResources();
  // Final flush on unload.
  addEventListener("pagehide", flush, { once: true });
}
