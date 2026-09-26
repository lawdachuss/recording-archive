import { describe, it, expect } from "vitest";
import { proxyImageUrl, proxyUrl, extractOriginalFromWsrv } from "../proxy-url";

/**
 * Host routing measured against production on 2026-09-26 (1,776 catalog URLs):
 *   img2.pixhost.to    1644  -> /api/media   (resizable, edge-cached)
 *   files.catbox.moe    120  -> server proxy 502s (blocks datacenter IPs)
 *   img3.pixhost.to      10  -> /api/media
 *   cdn.imgchest.com      2  -> /api/media works (200 + webp)
 */
describe("proxyImageUrl host routing", () => {
  it("sends imgchest through /api/media (it is reachable, was needlessly excluded)", () => {
    const url = "https://cdn.imgchest.com/files/e4287d56269e.jpg";
    expect(proxyUrl(url)).toContain("/api/media");

    const out = proxyImageUrl(url, { width: 640 })!;
    expect(out).toContain("/api/media");
    expect(out).toContain("w=640");
    expect(out).toContain("fmt=webp");
    // wsrv answers 400 for pixhost, but it does serve imgchest - we prefer our
    // own proxy because that path is already covered by the Cloudflare edge rule.
    expect(out).not.toMatch(/wsrv\.nl|weserv/);
  });

  it("resizes catbox thumbnails through wsrv instead of loading them direct", () => {
    // Direct catbox = full-resolution JPEG, no CDN (76KB-214KB, 1.4-3.5s).
    // wsrv = webp at the requested width off a shared edge cache (~28KB).
    const out = proxyImageUrl("https://files.catbox.moe/uzfi6z.jpg", { width: 640 })!;
    expect(out).toMatch(/wsrv\.nl|weserv/);
    expect(out).toContain("w=640");
    expect(out).toContain("output=webp");
    expect(out).not.toContain("/api/media");
  });

  it("keeps a recoverable direct URL for every wsrv thumbnail", () => {
    // This is the safety net for the wsrv 404 / dead-upstream-file case:
    // OptimizedImage switches to this on the first error instead of showing a
    // blank tile. If this ever returns null the wsrv path becomes a hard fail.
    for (const u of [
      "https://files.catbox.moe/uzfi6z.jpg",
      "https://catbox.moe/abc.jpg",
      "https://litter.catbox.moe/abc.jpg",
    ]) {
      const out = proxyImageUrl(u, { width: 640 })!;
      expect(extractOriginalFromWsrv(out), `no direct fallback for ${u}`).toBe(u);
    }
  });

  it("leaves animated/non-raster catbox media on the direct path", () => {
    // wsrv would flatten animated webp, so it must not be used for it.
    const out = proxyImageUrl("https://files.catbox.moe/abc123.webp", { width: 640 })!;
    expect(out).toBe("https://files.catbox.moe/abc123.webp");
  });

  it("never sends pixhost to wsrv (wsrv 400s on pixhost)", () => {
    for (const u of [
      "https://img2.pixhost.to/images/9927/756647736_archive17_mp4-thumb.jpg",
      "https://img3.pixhost.to/images/5657/769251746_maliinka_1-mp4-thumb.jpg",
    ]) {
      const out = proxyImageUrl(u, { width: 640 })!;
      expect(out).toContain("/api/media");
      expect(out).not.toMatch(/wsrv\.nl|weserv/);
    }
  });

  it("is idempotent when handed an already-proxied url", () => {
    const once = proxyImageUrl("https://cdn.imgchest.com/files/abc.jpg", { width: 640 })!;
    const twice = proxyImageUrl(once, { width: 640 })!;
    expect(twice).toBe(once);
  });

  it("preserves the upstream query string inside the proxy url", () => {
    const out = proxyImageUrl("https://cdn.imgchest.com/files/abc.jpg?v=2", { width: 640 })!;
    const parsed = new URL(out, "https://app.invalid");
    expect(parsed.searchParams.get("url")).toBe("https://cdn.imgchest.com/files/abc.jpg?v=2");
    expect(parsed.searchParams.get("w")).toBe("640");
  });
});
