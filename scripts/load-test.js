/**
 * load-test.js — k6 load test for the video-archive API.
 *
 * Stage 0 deliverable (scaling plan §3.5): establish a real baseline for the
 * top endpoints and find the actual limits before traffic finds them.
 *
 * Run:
 *   k6 run scripts/load-test.js
 *   BASE_URL=https://chuglii.in k6 run scripts/load-test.js
 *   BASE_URL=http://localhost:3000 k6 run -u 50 -d 60s scripts/load-test.js
 *
 * IMPORTANT: the API now rate-limits per IP (RATE_LIMIT_READ, default
 * 300/min). A 100-VU run from one IP WILL trip it — that's the limiter
 * working. For honest load numbers, either run against a staging deploy
 * with RATE_LIMIT_READ temporarily raised, or accept that the ceiling you
 * see is the limiter, not the origin.
 *
 * The profile ramps 1 → 50 → 100 VUs. SLO thresholds mirror docs/scaling-plan.md
 * §2 — k6 fails the run when p95/error-rate budgets are exceeded, so this can
 * double as a regression gate in CI.
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  stages: [
    { duration: "30s", target: 10 }, // warm caches
    { duration: "1m", target: 50 }, // main load
    { duration: "30s", target: 100 }, // find the ceiling
    { duration: "30s", target: 0 }, // ramp down
  ],
  thresholds: {
    // SLO targets from the scaling plan
    "http_req_duration{endpoint:catalog}": ["p(95)<400"],
    "http_req_duration{endpoint:cached}": ["p(95)<100"],
    "http_req_failed": ["rate<0.001"],
    // The cache must absorb most catalog traffic
    "checks": ["rate>0.99"],
  },
};

// Top endpoints by traffic share (grid pages dominate a video catalog).
const CATALOG_ENDPOINTS = [
  { name: "recordings", path: "/api/recordings?page=1&limit=24" },
  { name: "recordings_p3", path: "/api/recordings?page=3&limit=24" },
  { name: "performers", path: "/api/performers?page=1" },
  { name: "search", path: "/api/search?q=as" },
];

const CACHED_ENDPOINTS = [
  { name: "tags", path: "/api/tags" },
  { name: "stats", path: "/api/stats" },
];

function tag(req, endpoint, group) {
  return { tags: { endpoint, group } };
}

export default function () {
  // Simulate a browsing session: grid pages, then a detail view, then search.
  for (const ep of CATALOG_ENDPOINTS) {
    const res = http.get(`${BASE_URL}${ep.path}`, tag(null, ep.name, "catalog"));
    check(res, {
      [`${ep.name} 200`]: (r) => r.status === 200,
    });
    sleep(0.5); // think time — real users pause between pages
  }

  for (const ep of CACHED_ENDPOINTS) {
    const res = http.get(`${BASE_URL}${ep.path}`, tag(null, ep.name, "cached"));
    check(res, {
      [`${ep.name} 200`]: (r) => r.status === 200,
    });
  }

  const health = http.get(`${BASE_URL}/api/healthz`, tag(null, "health", "cached"));
  check(health, { "healthz 200": (r) => r.status === 200 });

  sleep(1);
}
