import { describe, it, expect, vi, beforeEach } from "vitest";
import userRouter from "../user.js";

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
    method: "PUT",
    path: "/user/profile",
    body,
    user: { id: userId, email: "user@example.com" },
    supabase: {
      from: () => ({
        upsert: () => ({
          select: () => ({
            single: async () => ({
              data: {
                user_id: userId,
                display_name: body.display_name?.slice(0, 100),
                avatar_url: body.avatar_url,
                bio: body.bio?.slice(0, 1000),
                username: body.username?.toLowerCase(),
                email: "user@example.com",
              },
              error: null,
            }),
          }),
        }),
      }),
    },
    log: { error: vi.fn(), warn: vi.fn() },
  };
}

describe("PUT /user/profile validation", () => {
  let putHandler: any;

  beforeEach(() => {
    const routeLayer = userRouter.stack.find(
      (layer: any) => layer.route?.path === "/user/profile" && layer.route?.methods?.put
    );
    if (!routeLayer?.route) {
      throw new Error("PUT /user/profile route not found");
    }
    putHandler = routeLayer.route.stack[0].handle;
  });

  it("rejects avatar_url with javascript: scheme", async () => {
    const res = makeRes();
    const req = makeReq({ avatar_url: "javascript:alert(1)" });
    await putHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("avatar_url must be a valid http(s) URL");
  });

  it("rejects avatar_url with data: scheme", async () => {
    const res = makeRes();
    const req = makeReq({ avatar_url: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" });
    await putHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("avatar_url must be a valid http(s) URL");
  });

  it("rejects avatar_url exceeding 2048 characters", async () => {
    const res = makeRes();
    const req = makeReq({ avatar_url: "https://example.com/" + "a".repeat(2045) });
    await putHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("avatar_url must be a valid http(s) URL");
  });

  it("accepts valid http and https avatar_urls", async () => {
    const res = makeRes();
    const req = makeReq({ avatar_url: "https://example.com/avatar.png" });
    await putHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.avatar_url).toBe("https://example.com/avatar.png");
  });

  it("rejects username with invalid characters or length < 3", async () => {
    const res = makeRes();
    const req = makeReq({ username: "ab" });
    await putHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("username must be 3-30 characters");
  });

  it("rejects username with spaces or special symbols", async () => {
    const res = makeRes();
    const req = makeReq({ username: "user name!" });
    await putHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("username must be 3-30 characters");
  });

  it("rejects username longer than 30 characters", async () => {
    const res = makeRes();
    const req = makeReq({ username: "a".repeat(31) });
    await putHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("username must be 3-30 characters");
  });

  it("accepts valid username, display_name, and bio", async () => {
    const res = makeRes();
    const req = makeReq({
      username: "valid_user-123",
      display_name: "John Doe",
      bio: "Hello world!",
      avatar_url: "http://images.example.com/me.jpg",
    });
    await putHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.username).toBe("valid_user-123");
    expect(res.body.display_name).toBe("John Doe");
    expect(res.body.bio).toBe("Hello world!");
  });
});
