import { describe, it, expect } from "vitest";
import {
  upNextTiming,
  secondsUntil,
  UP_NEXT_LEAD_SECONDS,
  UP_NEXT_TICK_MS,
} from "../up-next";

const NOW = 1_700_000_000_000;

describe("upNextTiming", () => {
  it("returns null for unknown or unusable durations", () => {
    expect(upNextTiming(0, NOW)).toBeNull();
    expect(upNextTiming(-12, NOW)).toBeNull();
    expect(upNextTiming(NaN, NOW)).toBeNull();
    expect(upNextTiming(Infinity, NOW)).toBeNull();
  });

  it("ends exactly durationSeconds after now", () => {
    const t = upNextTiming(120, NOW)!;
    expect(t.endsAt).toBe(NOW + 120_000);
  });

  it("shows the overlay UP_NEXT_LEAD_SECONDS before the end", () => {
    const t = upNextTiming(120, NOW)!;
    expect(t.showAt).toBe(NOW + (120 - UP_NEXT_LEAD_SECONDS) * 1000);
    expect(secondsUntil(t.endsAt, t.showAt)).toBe(UP_NEXT_LEAD_SECONDS);
  });

  it("clamps showAt to now for videos shorter than the lead window", () => {
    const t = upNextTiming(6, NOW)!;
    expect(t.showAt).toBe(NOW);
    expect(t.endsAt).toBe(NOW + 6_000);
    expect(secondsUntil(t.endsAt, t.showAt)).toBe(6);
  });

  it("exposes sane constants", () => {
    expect(UP_NEXT_LEAD_SECONDS).toBe(10);
    expect(UP_NEXT_TICK_MS).toBeGreaterThan(0);
    expect(UP_NEXT_TICK_MS).toBeLessThanOrEqual(1000);
  });
});

describe("secondsUntil", () => {
  it("rounds partial seconds up", () => {
    expect(secondsUntil(NOW + 1500, NOW)).toBe(2);
    expect(secondsUntil(NOW + 1, NOW)).toBe(1);
    expect(secondsUntil(NOW, NOW)).toBe(0);
  });

  it("goes zero-or-negative once the deadline passes", () => {
    expect(secondsUntil(NOW - 2500, NOW)).toBeLessThanOrEqual(0);
  });
});
