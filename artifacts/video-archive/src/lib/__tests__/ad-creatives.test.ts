import { describe, it, expect } from "vitest";
import { buildClickPopMarkup } from "../ad-creatives";

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
