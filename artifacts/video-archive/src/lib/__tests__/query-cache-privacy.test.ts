import { describe, expect, it } from "vitest";
import { sanitizePersistedQueryData } from "../query-client";

describe("sanitizePersistedQueryData", () => {
  it("removes user-specific query prefixes from legacy persisted snapshots", () => {
    const snapshot = {
      '["recordings","page=1"]': { data: ["public"], dataUpdatedAt: 10 },
      '["user","saved"]': { data: ["private-bookmarks"], dataUpdatedAt: 10 },
      '["user","history"]': { data: ["private-history"], dataUpdatedAt: 10 },
      '["premium"]': { data: { status: "active" }, dataUpdatedAt: 10 },
      '["my-requests"]': { data: ["private-requests"], dataUpdatedAt: 10 },
      '["recommendations","page=1"]': { data: ["personalized"], dataUpdatedAt: 10 },
      '["reactions","recording-id"]': { data: { liked: true }, dataUpdatedAt: 10 },
      '["comments","recording-id"]': { data: ["private-comments"], dataUpdatedAt: 10 },
    };

    expect(sanitizePersistedQueryData(snapshot)).toEqual({
      '["recordings","page=1"]': { data: ["public"], dataUpdatedAt: 10 },
    });
  });

  it("drops malformed query keys instead of restoring unknown data", () => {
    expect(sanitizePersistedQueryData({
      "not-json": { data: ["unknown"], dataUpdatedAt: 10 },
      "{}": { data: ["object-key"], dataUpdatedAt: 10 },
      "null": { data: ["null-key"], dataUpdatedAt: 10 },
      "42": { data: ["scalar-key"], dataUpdatedAt: 10 },
    })).toEqual({});
  });
});
