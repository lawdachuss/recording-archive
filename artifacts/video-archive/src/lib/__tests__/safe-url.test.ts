import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "../safe-url";

describe("safeExternalUrl", () => {
  it("accepts absolute HTTP and HTTPS URLs", () => {
    expect(safeExternalUrl("https://media.example/e/abc")).toBe("https://media.example/e/abc");
    expect(safeExternalUrl("http://media.example/watch?id=abc")).toBe("http://media.example/watch?id=abc");
  });

  it.each([
    "javascript:alert(1)",
    "javascript:/embed/alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://vault.test/123",
    "file:///etc/passwd",
    "//media.example/embed/abc",
    "/video/123",
    "https://user:password@media.example/embed/abc",
    "   ",
  ])("rejects unsafe or non-absolute URL %s", (value) => {
    expect(safeExternalUrl(value)).toBeNull();
  });
});
