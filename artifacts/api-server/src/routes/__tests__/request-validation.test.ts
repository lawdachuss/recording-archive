import { describe, it, expect, vi, beforeEach } from "vitest";
import requestsRouter from "../requests.js";

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

function makeReq(body: any, userId = "user-123") {
  return {
    method: "POST",
    path: "/requests",
    body,
    user: { id: userId, email: "user@example.com" },
    log: { error: vi.fn(), warn: vi.fn() },
  };
}

describe("POST /requests input validation", () => {
  let postHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const routeLayer = requestsRouter.stack.find(
      (layer: any) => layer.route?.path === "/requests" && layer.route?.methods?.post
    );
    if (!routeLayer?.route) {
      throw new Error("POST /requests route not found");
    }
    const handlers = routeLayer.route.stack.map((s: any) => s.handle);
    postHandler = handlers[handlers.length - 1];
  });

  it("rejects stream_link with javascript: scheme", async () => {
    const res = makeRes();
    const req = makeReq({
      platform: "chaturbate",
      stream_link: "javascript:alert(1)",
    });
    await postHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("stream_link must be a valid http(s) URL");
  });

  it("rejects stream_link with data: scheme", async () => {
    const res = makeRes();
    const req = makeReq({
      platform: "stripchat",
      stream_link: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    });
    await postHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("stream_link must be a valid http(s) URL");
  });

  it("rejects stream_link exceeding 2048 characters", async () => {
    const res = makeRes();
    const req = makeReq({
      platform: "chaturbate",
      stream_link: "https://chaturbate.com/" + "a".repeat(2040),
    });
    await postHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("stream_link must be a valid http(s) URL");
  });

  it("rejects performer_username exceeding 100 characters", async () => {
    const res = makeRes();
    const req = makeReq({
      platform: "chaturbate",
      performer_username: "a".repeat(101),
    });
    await postHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("performer_username must be a string up to 100 characters");
  });

  it("rejects non-string stream_link without crashing", async () => {
    const res = makeRes();
    const req = makeReq({
      platform: "chaturbate",
      stream_link: 12345,
    });
    await postHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("stream_link must be a valid http(s) URL");
  });

  it("rejects notes exceeding 1000 characters", async () => {
    const res = makeRes();
    const req = makeReq({
      platform: "chaturbate",
      performer_username: "testperformer",
      notes: "a".repeat(1001),
    });
    await postHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("notes must be a string up to 1000 characters");
  });
});
