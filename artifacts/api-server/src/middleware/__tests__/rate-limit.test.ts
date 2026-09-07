import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clientIp, rateLimit, _resetMemoryWindowsForTests } from "../rate-limit.js";
import * as redis from "../../lib/redis.js";

// Force the in-memory fallback for these tests: no Redis connection.
vi.mock("../../lib/redis.js", () => ({
  getRedis: () => null,
  isRedisConnected: () => false,
}));

type Handler = (req: any, res: any) => void;

function makeRes() {
  const headers: Record<string, string | number> = {};
  const state = { code: 200, body: null as Record<string, unknown> | null };
  return {
    headers,
    get statusCode() {
      return state.code;
    },
    get body() {
      return state.body;
    },
    set(keyOrHeaders: string | Record<string, string | number>, value?: string | number) {
      if (typeof keyOrHeaders === "string") {
        headers[keyOrHeaders] = value as string | number;
      } else {
        Object.assign(headers, keyOrHeaders);
      }
    },
    status(code: number) {
      state.code = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload as Record<string, unknown>;
      return this;
    },
  };
}

function makeReq(headers: Record<string, string> = {}, path = "/x") {
  return {
    headers,
    path,
    method: "GET",
    socket: { remoteAddress: "127.0.0.1" },
    log: { error: () => {}, warn: () => {} },
  };
}

async function run(mw: ReturnType<typeof rateLimit>, req: any, res: any): Promise<boolean> {
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

describe("rate limiter (memory fallback)", () => {
  beforeEach(() => {
    _resetMemoryWindowsForTests();
    vi.spyOn(redis, "getRedis").mockReturnValue(null);
    vi.spyOn(redis, "isRedisConnected").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests under the limit", async () => {
    const mw = rateLimit({ bucket: "search", limit: 3 });
    const res = makeRes();
    const next = await run(mw, makeReq({ "x-real-ip": "1.2.3.4" }), res);
    expect(next).toBe(true);
    expect(res.headers["RateLimit-Limit"]).toBeDefined();
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    const mw = rateLimit({ bucket: "search", limit: 5 });
    for (let i = 0; i < 5; i++) {
      await run(mw, makeReq({ "x-real-ip": "5.6.7.8" }), makeRes());
    }
    const res = makeRes();
    const next = await run(mw, makeReq({ "x-real-ip": "5.6.7.8" }), res);
    expect(next).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeDefined();
    expect(res.headers["RateLimit-Remaining"]).toBe("0");
    expect(res.body?.error).toBe("Too many requests");
  });

  it("counts different clients independently", async () => {
    const mw = rateLimit({ bucket: "search", limit: 2 });
    await run(mw, makeReq({ "x-real-ip": "9.9.9.9" }), makeRes());
    await run(mw, makeReq({ "x-real-ip": "9.9.9.9" }), makeRes());
    const other = await run(mw, makeReq({ "x-real-ip": "8.8.8.8" }), makeRes());
    expect(other).toBe(true);
  });

  it("prefers x-real-ip over the first x-forwarded-for entry", async () => {
    const mw = rateLimit({ bucket: "search", limit: 2 });
    const headers = { "x-forwarded-for": "1.1.1.1, 2.2.2.2" };
    await run(mw, makeReq(headers), makeRes());
    await run(mw, makeReq(headers), makeRes());
    const res = makeRes();
    const next = await run(mw, makeReq(headers), res);
    expect(next).toBe(false);
    expect(res.statusCode).toBe(429);
  });

  it("resets the window after expiry", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    try {
      const mw = rateLimit({ bucket: "search", limit: 6 });
      for (let i = 0; i < 6; i++) {
        await run(mw, makeReq({ "x-real-ip": "7.7.7.7" }), makeRes());
      }
      const limited = makeRes();
      await run(mw, makeReq({ "x-real-ip": "7.7.7.7" }), limited);
      expect(limited.statusCode).toBe(429);

      // Jump past the 60s window
      vi.advanceTimersByTime(61_000);
      const res = makeRes();
      const next = await run(mw, makeReq({ "x-real-ip": "7.7.7.7" }), res);
      expect(next).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips via the skip predicate", async () => {
    const mw = rateLimit({ bucket: "search", limit: 1, skip: (req) => req.path === "/healthz" });
    for (let i = 0; i < 20; i++) {
      const res = makeRes();
      const next = await run(mw, makeReq({}, "/healthz"), res);
      expect(next).toBe(true);
    }
  });

  it("keys by token hash when keyFn is provided", async () => {
    const mw = rateLimit({ bucket: "user", limit: 5, keyFn: () => "tok-abc" });
    for (let i = 0; i < 5; i++) {
      await run(mw, makeReq(), makeRes());
    }
    const res = makeRes();
    const next = await run(mw, makeReq(), res);
    expect(next).toBe(false);
    expect(res.statusCode).toBe(429);
  });

  it("clientIp falls back to socket address", () => {
    expect(clientIp(makeReq() as any)).toBe("127.0.0.1");
  });
});
