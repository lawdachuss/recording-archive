import { describe, expect, it } from "vitest";
import { sanitizeActivityPath } from "../rum";

describe("sanitizeActivityPath", () => {
  it("removes query strings that may contain one-time auth codes or private search terms", () => {
    expect(sanitizeActivityPath("/auth/callback?code=one-time-secret&state=private")).toBe("/auth/callback");
    expect(sanitizeActivityPath("/browse?q=private+search&sort=newest")).toBe("/browse");
  });

  it("removes fragments that may contain access tokens", () => {
    expect(sanitizeActivityPath("/auth/callback#access_token=secret&refresh_token=secret")).toBe("/auth/callback");
  });

  it("keeps the route path and caps its length", () => {
    expect(sanitizeActivityPath("/video/abc")).toBe("/video/abc");
    expect(sanitizeActivityPath("/" + "a".repeat(300))).toHaveLength(256);
  });

  it("uses the root path for an empty value", () => {
    expect(sanitizeActivityPath("")).toBe("/");
  });
});
