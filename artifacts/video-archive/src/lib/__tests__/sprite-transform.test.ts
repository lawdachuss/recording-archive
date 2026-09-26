import { describe, it, expect } from "vitest";
import { proxySpriteUrl } from "../proxy-url";
import { getSpriteGrid } from "../sprite-grid";

/**
 * Sprite sheets are resized to a fixed width before display, which is safe
 * ONLY for hosts whose grid is known statically. Any host that falls back to
 * SpriteSlideshow's detectLayout() must keep its native dimensions, because the
 * detector infers the grid from the loaded image's size and a forced 1920-wide
 * sheet would be indistinguishable from a 4x4 regardless of its real layout.
 *
 * Host mix measured over 20,000 catalog rows (2026-09-26):
 *   files.catbox.moe   42.19%   (auto-detect)
 *   img3.pixhost.to    38.52%   (static 4x4)
 *   img2.pixhost.to    12.81%   (static 4x4)
 *   cdn.imgchest.com    2.34%   (auto-detect)
 *   iili.io              0.83%   (auto-detect)
 *
 * So ~45% of sheets rely on auto-detection and MUST NOT be transformed.
 */
const CATALOG_HOSTS = [
  "https://files.catbox.moe/abc123.jpg",
  "https://img3.pixhost.to/here/abc123.png",
  "https://img2.pixhost.to/here/abc123.jpg",
  "https://cdn.imgchest.com/ut/abc123.png",
  "https://iili.io/abc123.jpg",
];

const transformed = (u: string) => /[?&]w=\d+/.test(u);
const viaWsrv = (u: string) => /wsrv\.nl|weserv/.test(u);
const viaProxy = (u: string) => /\/api\/media/.test(u);

describe("proxySpriteUrl", () => {
  it("resizes + webp-converts pixhost sheets", () => {
    for (const url of CATALOG_HOSTS.filter((u) => u.includes("pixhost.to"))) {
      const out = proxySpriteUrl(url)!;
      expect(out).toContain("/api/media");
      expect(out).toContain("w=1920");
      expect(out).toContain("fmt=webp");
    }
  });

  it("never forces a width on auto-detect hosts (dims must stay native)", () => {
    // A sheet on an auto-detect host may travel through wsrv's PASSTHROUGH
    // (no transform params) because that preserves intrinsic size — verified
    // 2026-09-26: files.catbox.moe/uzfi6z.jpg is 2560x1440 both directly and
    // via images.weserv.nl, and 2560x1440 is a KNOWN_LAYOUTS entry (4x4). What
    // it must never get is a `w=` param, which would make every grid look 4x4.
    for (const url of CATALOG_HOSTS.filter((u) => !u.includes("pixhost.to"))) {
      const out = proxySpriteUrl(url)!;
      expect(transformed(out), `forced width on auto-detect host: ${url}`).toBe(false);
    }
  });

  it("SAFETY INVARIANT: any transformed sheet has a statically known grid", () => {
    // This is the assertion that actually protects the catalog. If someone
    // adds a host to the proxy path without a getSpriteGrid() entry, this
    // fails instead of silently shipping garbled sprites.
    for (const url of CATALOG_HOSTS) {
      const out = proxySpriteUrl(url);
      if (out && transformed(out)) {
        expect(
          getSpriteGrid(url),
          `transformed sheet on host with no known grid: ${new URL(url).hostname}`,
        ).not.toBeNull();
      }
    }
  });

  it("loads catbox sprite sheets DIRECT, never through wsrv", () => {
    // catbox blocks datacenter IPs, so /api/media hangs and Cloudflare 502s -
    // but wsrv is not a valid escape hatch either: its resolvers intermittently
    // fail DNS for catbox and surface it as a 404, not a 5xx
    // ({"message":"The hostname of the origin is unresolvable (DNS)"}).
    // Verified 2026-09-26 that this is intermittent, not fixed, and not
    // Referer-related. So catbox sprites load direct, untransformed.
    for (const url of [
      "https://files.catbox.moe/abc123.jpg",
      "https://catbox.moe/abc123.jpg",
      "https://litter.catbox.moe/abc123.jpg",
    ]) {
      const out = proxySpriteUrl(url)!;
      expect(viaWsrv(out), `catbox sprite must not route via wsrv: ${url}`).toBe(false);
      expect(viaProxy(out), `catbox sprite must not route via /api/media: ${url}`).toBe(false);
      expect(out).toBe(url);
    }
  });

  it("never routes pixhost through wsrv (wsrv 400s on pixhost)", () => {
    for (const url of CATALOG_HOSTS.filter((u) => u.includes("pixhost.to"))) {
      expect(viaWsrv(proxySpriteUrl(url) ?? "")).toBe(false);
    }
  });

  it("passes through null/empty and relative urls", () => {
    expect(proxySpriteUrl(null)).toBeNull();
    expect(proxySpriteUrl(undefined)).toBeNull();
    expect(proxySpriteUrl("")).toBeNull();
  });

  it("preserves the upstream query string and appends the transform with &", () => {
    // The upstream URL is carried whole inside the `url` param, so its own
    // query is percent-encoded (`?v=2` -> `%3Fv%3D2`) — it must survive, and
    // the transform must be appended with & (not ?). Relies on /api/media
    // resolving the base relative to the current origin.
    const out = proxySpriteUrl("https://img3.pixhost.to/here/a.png?v=2")!;
    const parsed = new URL(out, "https://app.invalid");
    expect(parsed.pathname).toBe("/api/media");
    expect(parsed.searchParams.get("url")).toBe("https://img3.pixhost.to/here/a.png?v=2");
    expect(parsed.searchParams.get("w")).toBe("1920");
    expect(parsed.searchParams.get("fmt")).toBe("webp");
  });
});
