import { describe, it, expect } from "vitest";
import {
  buildClickPopMarkup,
  bareUrlToMarkup,
  isSelfContainedLine,
  pickPopunderMarkup,
  withJQueryBootstrap,
} from "../ad-creatives";

const POPUNDER =
  "<script src='https://chaturbate.com/affiliates/promotools/popup/LKGEE/popchaturbate.js' type='text/javascript'></script>";

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

  it("self-heals an image-extension URL that serves HTML into a slot-sized iframe", () => {
    const html = bareUrlToMarkup("https://w.example/wrapper?bb=1.gif", 970, 250);
    expect(html).toContain("onerror=");
    expect(html).toContain("createElement('iframe')");
    // The swap reuses this.src — the URL is never re-embedded in JS.
    expect(html).toContain("i.src=this.src");
    expect(html).toContain("this.replaceWith(i)");
    expect(html).toContain('i.width=this.width');
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

describe("withJQueryBootstrap", () => {
  it("prepends jQuery BEFORE a creative that needs it", () => {
    const out = withJQueryBootstrap(POPUNDER, false);
    expect(out).toContain("ajax.googleapis.com/ajax/libs/jquery");
    // Ordering matters: injectAdMarkup runs scripts in HTML-parser order, so
    // jQuery must be the FIRST script in the chain.
    expect(out.indexOf("jquery")).toBeLessThan(out.indexOf("chaturbate"));
    expect(out.endsWith(POPUNDER)).toBe(true);
  });

  it("matches the jQuery/$(…) signals real pop codes actually use", () => {
    expect(withJQueryBootstrap("<script>doMyStuff(jQuery)</script>", false)).toContain("jquery");
    expect(withJQueryBootstrap("<script>$(document).ready(f)</script>", false)).toContain("jquery");
  });

  it("bootstraps jQuery for EXTERNAL scripts, whose remote bodies we cannot inspect", () => {
    const out = withJQueryBootstrap('<script src="https://x.example/pop.js"></script>', false);
    expect(out).toContain("ajax.googleapis.com/ajax/libs/jquery");
    expect(out.endsWith('<script src="https://x.example/pop.js"></script>')).toBe(true);
  });

  it("leaves the creative alone when jQuery is already on the page", () => {
    const html = "<script>doMyStuff(jQuery)</script>";
    expect(withJQueryBootstrap(html, true)).toBe(html);
    expect(withJQueryBootstrap(POPUNDER, true)).toBe(POPUNDER);
  });

  it("leaves inline creatives that need nothing alone", () => {
    const inline = "<script>window.open('https://x.example')</script>";
    expect(withJQueryBootstrap(inline, false)).toBe(inline);
    // The StripCash click-pop is inline and jQuery-free — no wasted download.
    const clickPop = buildClickPopMarkup("https://go.stripchat.com/?userId=abc")!;
    expect(withJQueryBootstrap(clickPop, false)).toBe(clickPop);
  });
});

describe("pickPopunderMarkup", () => {
  const STRIPCASH = buildClickPopMarkup("https://go.stripchat.com/?userId=abc")!;

  it("always prefers the configured popunder over the StripCash click-pop", () => {
    // Regression: both used to share one Math.random() pick, so a live
    // STRIPCASH_API_KEY suppressed the real popunder on ~half of page loads.
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickPopunderMarkup([POPUNDER], STRIPCASH, () => r)).toBe(POPUNDER);
    }
  });

  it("still rotates between several configured popunder creatives", () => {
    const other = "<script src='https://n.example/pop2.js'></script>";
    expect(pickPopunderMarkup([POPUNDER, other], STRIPCASH, () => 0)).toBe(POPUNDER);
    expect(pickPopunderMarkup([POPUNDER, other], STRIPCASH, () => 0.99)).toBe(other);
  });

  it("falls back to the StripCash click-pop only when the slot is empty", () => {
    expect(pickPopunderMarkup([], STRIPCASH, () => 0.5)).toBe(STRIPCASH);
    expect(pickPopunderMarkup(["   "], STRIPCASH, () => 0.5)).toBe(STRIPCASH);
  });

  it("returns null when there is nothing to fire at all", () => {
    expect(pickPopunderMarkup([], null)).toBeNull();
    expect(pickPopunderMarkup([], undefined)).toBeNull();
    expect(pickPopunderMarkup([], "")).toBeNull();
    expect(pickPopunderMarkup([], "  ")).toBeNull();
    expect(pickPopunderMarkup(["  "], null)).toBeNull();
  });
});
