import { describe, it, expect } from "vitest";
import { pickPreroll, PREROLL_SKIP_AFTER_MS, PREROLL_START_TIMEOUT_MS } from "../preroll";
import type { AdRow } from "../../contexts/AdsContext";

const row = (over: Partial<AdRow>): AdRow => ({
  id: Math.random().toString(36).slice(2),
  slot: "preroll",
  kind: "url",
  content: "https://video.whitetrafsa.com/production/prerolls/a.mp4",
  enabled: true,
  ...over,
});

describe("pickPreroll", () => {
  it("picks one enabled url row as a raw video creative", () => {
    const rows = [
      row({ content: "https://cdn.x/one.mp4" }),
      row({ content: "https://cdn.x/two.mp4" }),
    ];
    const pick = pickPreroll(rows);
    expect(pick).not.toBeNull();
    expect(pick!.type).toBe("video");
    expect(["https://cdn.x/one.mp4", "https://cdn.x/two.mp4"]).toContain(
      (pick as { url: string }).url,
    );
  });

  it("ignores other slots, disabled rows and malformed content", () => {
    expect(pickPreroll([row({ slot: "medium-rect-300x250" })])).toBeNull();
    expect(pickPreroll([row({ enabled: false })])).toBeNull();
    expect(pickPreroll([row({ kind: "url", content: "not a url" })])).toBeNull();
    expect(pickPreroll([row({ kind: "html", content: "" })])).toBeNull();
    expect(pickPreroll([])).toBeNull();
  });

  it("passes pasted iframe embeds through as html creatives", () => {
    const html = '<iframe src="https://w.example/ad" width="640" height="360"></iframe>';
    const pick = pickPreroll([row({ kind: "html", content: html })]);
    expect(pick).toEqual({ type: "html", html });
  });

  it("falls back to the file slot (no rows = ads/preroll.txt, empty by default)", () => {
    // rows === null → file fallback; the shipped preroll.txt is comment-only.
    expect(pickPreroll(null)).toBeNull();
  });

  it("exposes the standard skip/watchdog timings", () => {
    expect(PREROLL_SKIP_AFTER_MS).toBe(5_000);
    expect(PREROLL_START_TIMEOUT_MS).toBeGreaterThanOrEqual(PREROLL_SKIP_AFTER_MS);
  });
});
