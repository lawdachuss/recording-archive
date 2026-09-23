import { describe, it, expect } from "vitest";
import { slotDims, decideCreative, isFrameable, sniffBannerUrl } from "../ad-sniff.js";

const DIMS = { width: 970, height: 250 };

const probe = (contentType: string | null, opts: { ok?: boolean; headers?: Record<string, string> } = {}) => ({
  ok: opts.ok ?? true,
  contentType,
  headers: new Headers(opts.headers ?? {}),
});

describe("slotDims", () => {
  it("parses dimensions from banner slot ids", () => {
    expect(slotDims("billboard-970x250")).toEqual({ width: 970, height: 250 });
    expect(slotDims("mobile-banner-320x50")).toEqual({ width: 320, height: 50 });
  });

  it("returns null for dimension-less slots (raw content by design)", () => {
    expect(slotDims("popunder")).toBeNull();
    expect(slotDims("direct-link")).toBeNull();
    expect(slotDims("preroll")).toBeNull(); // video URLs must stay raw for <video src>
  });
});

describe("decideCreative", () => {
  it("keeps a served image as the raw link (frontend renders the <img>)", () => {
    expect(decideCreative("https://cdn.x/banner.gif", DIMS, probe("image/gif"))).toEqual({
      kind: "url",
      content: "https://cdn.x/banner.gif",
    });
  });

  it("embeds extension-less images as an explicit sized <img>", () => {
    const d = decideCreative("https://cdn.x/get?id=1", DIMS, probe("image/png"));
    expect(d.kind).toBe("html");
    expect(d.content).toContain("<img");
    expect(d.content).toContain('src="https://cdn.x/get?id=1"');
    expect(d.content).toContain('width="970"');
    expect(d.content).toContain('height="250"');
  });

  it("auto-embeds a frameable HTML widget as a slot-sized iframe", () => {
    const url = "https://w.example/widgets/wrapper?bb=1.gif";
    const d = decideCreative(url, DIMS, probe("text/html; charset=utf-8"));
    expect(d.kind).toBe("html");
    expect(d.content).toContain(`<iframe src="${url}"`);
    expect(d.content).toContain('width="970" height="250"');
    expect(d.content).toContain('frameborder="0"');
    expect(d.content).toContain('scrolling="no"');
  });

  it("keeps frame-REFUSING extension-less pages as raw links (frontend boxes them)", () => {
    const url = "https://go.example/?offer=1";
    const d = decideCreative(url, DIMS, probe("text/html", { headers: { "x-frame-options": "SAMEORIGIN" } }));
    // Raw link preserved for editing — the frontend's clickable box renders
    // it exactly the same way, and an <iframe> of a frame-refusing page would
    // be blank.
    expect(d).toEqual({ kind: "url", content: url });
    expect(d.content).not.toContain("<iframe");
  });

  it("keeps a frame-refusing URL WITH an image extension clickable (frontend would <img> it)", () => {
    const d = decideCreative("https://x.example/go.gif", DIMS, probe("text/html", { headers: { "x-frame-options": "deny" } }));
    expect(d.kind).toBe("html");
    expect(d.content).toContain("<a href=");
    expect(d.content).not.toContain("<img");
    expect(d.content).not.toContain("<iframe");
  });

  it("frames a frameable URL even when it carries an image extension", () => {
    const d = decideCreative("https://w.example/wrapper?bb=2.gif", DIMS, probe("text/html"));
    expect(d.kind).toBe("html");
    expect(d.content).toContain("<iframe");
  });

  it("falls back to the raw link on non-OK or unknown responses", () => {
    expect(decideCreative("https://x.example/b.gif", DIMS, probe("text/html", { ok: false })).kind).toBe("url");
    expect(decideCreative("https://x.example/b.gif", DIMS, probe("application/json")).kind).toBe("url");
    expect(decideCreative("https://x.example/b", DIMS, probe(null)).kind).toBe("url");
  });
});

describe("isFrameable", () => {
  it("allows embedding when no frame policy is set", () => {
    expect(isFrameable(new Headers())).toBe(true);
  });

  it("blocks on X-Frame-Options deny/sameorigin", () => {
    expect(isFrameable(new Headers({ "x-frame-options": "DENY" }))).toBe(false);
    expect(isFrameable(new Headers({ "x-frame-options": "SAMEORIGIN" }))).toBe(false);
  });

  it("reads CSP frame-ancestors: 'self' blocks, * allows", () => {
    expect(isFrameable(new Headers({ "content-security-policy": "frame-ancestors 'self'" }))).toBe(false);
    expect(isFrameable(new Headers({ "content-security-policy": "frame-ancestors *" }))).toBe(true);
    expect(isFrameable(new Headers({ "content-security-policy": "default-src 'self'; frame-ancestors https:" }))).toBe(true);
  });
});

describe("sniffBannerUrl", () => {
  it("never throws — an unreachable host keeps the raw link", async () => {
    const d = await sniffBannerUrl("http://127.0.0.1:9/x", DIMS);
    expect(d).toEqual({ kind: "url", content: "http://127.0.0.1:9/x" });
  }, 15_000);
});
