import { describe, expect, it } from "vitest";
import { normalizeLoginUsername } from "../username-auth.js";

describe("normalizeLoginUsername", () => {
  it("normalizes valid usernames", () => {
    expect(normalizeLoginUsername("  My_User-7 ")).toBe("my_user-7");
  });

  it("rejects malformed, short, long, and non-string values", () => {
    expect(normalizeLoginUsername("ab")).toBeNull();
    expect(normalizeLoginUsername("has spaces")).toBeNull();
    expect(normalizeLoginUsername("name@example.com")).toBeNull();
    expect(normalizeLoginUsername("x".repeat(31))).toBeNull();
    expect(normalizeLoginUsername(null)).toBeNull();
    expect(normalizeLoginUsername(42)).toBeNull();
  });
});
