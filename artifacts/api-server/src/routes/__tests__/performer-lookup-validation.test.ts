import { describe, it, expect, vi, beforeEach } from "vitest";
import performerRouter from "../performers.js";

function makeRes() {
  const state = { code: 200, body: null as any };
  return {
    get statusCode() { return state.code; },
    get body() { return state.body; },
    status(code: number) { state.code = code; return this; },
    json(payload: unknown) { state.body = payload; return this; },
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
      (layer: any) => layer.route?.path === "/performers/lookup" && layer.route?.methods?.get,
    );
    if (!routeLayer?.route) throw new Error("GET /performers/lookup route not found");
    lookupHandler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
  });

  it("rejects missing platform or username", async () => {
    const res = makeRes();
    await lookupHandler(makeReq({ username: "alice" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("platform and username are required");
  });

  it("rejects unsupported platforms", async () => {
    const res = makeRes();
    await lookupHandler(makeReq({ platform: "other", username: "alice" }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('platform must be "chaturbate" or "stripchat"');
  });

  it.each([
    "../admin", "user/name", "user?query=1", "user#fragment", "user+name",
    "user*name", "user[0]", "user name", "user@host.com", "a".repeat(101),
  ])("rejects unsafe username %s", async (username) => {
    const res = makeRes();
    await lookupHandler(makeReq({ platform: "stripchat", username }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("username must be between 1 and 100 characters");
  });
});
