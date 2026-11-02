import { describe, it, expect, vi, beforeEach } from "vitest";
import performerRouter from "../performers.js";

function makeRes() {
  const state = { code: 200, body: null as any };
  return {
    get statusCode() {
      return state.code;
    },
    get body() {
      return state.body;
    },
    status(code: number) {
      state.code = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  };
}

function makeReq(query: Record<string, string>) {
  return {
    method: "GET",
    path: "/performers/lookup",
    query,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
}

describe("GET /performers/lookup input validation", () => {
  let lookupHandler: any;

  beforeEach(() => {
    const routeLayer = performerRouter.stack.find(
      (layer: any) =>
        layer.route?.path === "/performers/lookup" && layer.route?.methods?.get,
    );
    if (!routeLayer?.route) {
      throw new Error("GET /performers/lookup route not found");
    }
    // Route stack has cache middleware then the handler
    lookupHandler =
      routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
  });

  it("rejects request missing platform or username", async () => {
    const res1 = makeRes();
    const req1 = makeReq({ username: "alice" });
    await lookupHandler(req1, res1);
    expect(res1.statusCode).toBe(400);
    expect(res1.body.error).toContain("platform and username are required");

    const res2 = makeRes();
    const req2 = makeReq({ platform: "chaturbate" });
    await lookupHandler(req2, res2);
    expect(res2.statusCode).toBe(400);
    expect(res2.body.error).toContain("platform and username are required");
  });

  it("rejects invalid platform", async () => {
    const res = makeRes();
    const req = makeReq({ platform: "onlyfans", username: "alice" });
    await lookupHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain(
      'platform must be "chaturbate" or "stripchat"',
    );
  });

  it("rejects username with path traversal sequences", async () => {
    const res = makeRes();
    const req = makeReq({ platform: "stripchat", username: "../admin" });
    await lookupHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain(
      "username must be between 1 and 100 characters",
    );
  });

  it("rejects username with regex/url injection characters", async () => {
    const dangerousInputs = [
      "user/name",
      "user?query=1",
      "user#fragment",
      "user+name",
      "user*name",
      "user[0]",
      "user name",
      "user@host.com",
    ];

    for (const username of dangerousInputs) {
      const res = makeRes();
      const req = makeReq({ platform: "stripchat", username });
      await lookupHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain(
        "username must be between 1 and 100 characters",
      );
    }
  });

  it("rejects username exceeding 100 characters", async () => {
    const res = makeRes();
    const req = makeReq({ platform: "chaturbate", username: "a".repeat(101) });
    await lookupHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain(
      "username must be between 1 and 100 characters",
    );
  });
});
