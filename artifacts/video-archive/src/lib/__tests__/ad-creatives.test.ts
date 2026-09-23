import { describe, it, expect } from "vitest";
import { buildClickPopMarkup, bareUrlToMarkup, isSelfContainedLine } from "../ad-creatives";

describe("isSelfContainedLine", () => {
  it("recognises complete one-line codes as self-contained", () => {
    expect(
      isSelfContainedLine(
        '<iframe src="https://x.example/w?bb=1.gif" width="950" height="250" frameborder="0" scrolling="no"></iframe>',
      ),
    ).toBe(true);
    expect(isSelfContainedLine('<script src="https://x.example/a.js"></script>')).toBe(true);
    expect(isSelfContainedLine('<a href="https://x.example"><img src="https://x.example/b.gif"></a>')).toBe(true);
    expect(isSelfContainedLine('<img src="https://x.example/b.gif" alt="ad" />')).toBe(true);
    expect(isSelfContainedLine('  <div class="ad-box">promo</div>  ')).toBe(true);
  });

  it("rejects continuation lines and non-markup", () => {
    expect(isSelfContainedLine('<a href="https://x.example">')).toBe(false); // opener only
    expect(isSelfContainedLine("</a>")).toBe(false);
    expect(isSelfContainedLine("document.write('ad');")).toBe(false);
    expect(isSelfContainedLine("")).toBe(false);
    expect(isSelfContainedLine("<p>unclosed")).toBe(false);
  });

  it("requires the closing tag name to match the opener", () => {
    expect(isSelfContainedLine("<div>x</span>")).toBe(false);
    expect(isSelfContainedLine("<div><div>nested</div></div>")).toBe(true);
  });
});

describe("bareUrlToMarkup", () => {
  it("turns an image URL into a sized <img>", () => {
    const html = bareUrlToMarkup("https://cdn.example.com/banner.gif?x=1", 728, 90);
    expect(html).not.toBeNull();
    expect(html).toContain("<img");
    expect(html).toContain('src="https://cdn.example.com/banner.gif?x=1"');
    expect(html).toContain('width="728"');
    expect(html).toContain('height="90"');
  });

  it("turns a bare StripCash smartlink into a clickable banner instead of rejecting it", () => {
    const html = bareUrlToMarkup("https://go.stripchat.com/?userId=abc&p1=vault", 728, 90);
    expect(html).not.toBeNull();
    expect(html).toContain('<a href="https://go.stripchat.com/?userId=abc&p1=vault"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="sponsored noopener nofollow"');
    expect(html).toContain("height:90px");
    expect(html).toContain("Advertisement");
    expect(html).not.toContain("<img");
  });

  it("quote-escapes the URL in the href", () => {
    const html = bareUrlToMarkup('https://x.com/?a="b"', 300, 100);
    expect(html).not.toBeNull();
    expect(html).toContain("&quot;b&quot;");
  });

  it("returns null only for an empty input", () => {
    expect(bareUrlToMarkup("", 300, 100)).toBeNull();
  });
});

describe("buildClickPopMarkup", () => {
  it("builds a once-per-load click pop for a valid URL", () => {
    const html = buildClickPopMarkup("https://go.stripchat.com/?userId=abc");
    expect(html).not.toBeNull();
    expect(html!.startsWith("<script>")).toBe(true);
    expect(html!.endsWith("</script>")).toBe(true);
    expect(html).toContain("window.open");
    expect(html).toContain('addEventListener("click"');
    expect(html).toContain('removeEventListener("click"');
    expect(html).toContain("https://go.stripchat.com/?userId=abc");
    expect(html).toContain('"_blank"');
    expect(html).toContain('"noopener,noreferrer"');
  });

  it("rejects anything that isn't a bare http(s) URL", () => {
    expect(buildClickPopMarkup("")).toBeNull();
    expect(buildClickPopMarkup("   ")).toBeNull();
    expect(buildClickPopMarkup("javascript:alert(1)")).toBeNull();
    expect(buildClickPopMarkup("https://x.com/ has spaces")).toBeNull();
    expect(buildClickPopMarkup("ftp://x.com/file")).toBeNull();
  });

  it("escapes angle brackets so a crafted URL can't break out of the script tag", () => {
    const html = buildClickPopMarkup("https://x.com/</script><b>");
    expect(html).not.toBeNull();
    // Exactly one closing tag: the wrapper's own — none from the URL.
    expect(html!.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c");
  });

  it("JSON-escapes quotes in the URL", () => {
    const html = buildClickPopMarkup('https://x.com/?a="b"');
    expect(html).not.toBeNull();
    expect(html).toContain('\\"b\\"');
  });
});
