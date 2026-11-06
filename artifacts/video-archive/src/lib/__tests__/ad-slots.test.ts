import { describe, expect, it } from "vitest";
import { DEFAULT_AD_SETTINGS, mergeAdSettings } from "../ad-slots";

describe("mergeAdSettings", () => {
  it("ignores unknown page and placement switches", () => {
    const result = mergeAdSettings({
      pages: { home: false, unknown: false },
      placements: { strip: false, unknown: true },
    });
    expect(result.pages).toEqual({ home: false });
    expect(result.placements).toEqual({ strip: false });
  });

  it("uses defaults for null and malformed nested values", () => {
    expect(mergeAdSettings({
      pages: [],
      placements: null,
      inCard: [],
      rotationSeconds: null,
    })).toEqual(DEFAULT_AD_SETTINGS);
  });

  it("rejects non-display slots for in-card ads", () => {
    for (const slot of ["popunder", "direct-link", "preroll", "not-a-slot", ""]) {
      expect(mergeAdSettings({ inCard: { slot } }).inCard.slot).toBe(DEFAULT_AD_SETTINGS.inCard.slot);
    }
  });

  it("clamps numeric settings and accepts numeric strings", () => {
    expect(mergeAdSettings({
      inCard: { maxPerPage: "99", slot: "leaderboard-728x90" },
      rotationSeconds: "2",
    })).toMatchObject({
      inCard: { maxPerPage: 6, slot: "leaderboard-728x90" },
      rotationSeconds: 5,
    });
    expect(mergeAdSettings({
      inCard: { maxPerPage: -3 },
      rotationSeconds: 999,
    })).toMatchObject({
      inCard: { maxPerPage: 0 },
      rotationSeconds: 120,
    });
  });

  it("does not coerce null or empty strings to zero", () => {
    expect(mergeAdSettings({
      inCard: { maxPerPage: null },
      rotationSeconds: "",
    })).toEqual(DEFAULT_AD_SETTINGS);
  });
});
