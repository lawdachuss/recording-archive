import { describe, it, expect } from "vitest";
import { byPositionThenNewest, moveItem } from "../list-order";

const item = (id: string, over: Record<string, unknown> = {}) => ({ id, ...over });

describe("byPositionThenNewest", () => {
  it("sorts primarily by position", () => {
    const items = [item("c", { position: 2 }), item("a", { position: 0 }), item("b", { position: 1 })];
    expect([...items].sort(byPositionThenNewest).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("pushes unranked (null/undefined position) rows after ranked ones", () => {
    const items = [
      item("legacy", { position: null }),
      item("b", { position: 1 }),
      item("unranked"),
      item("a", { position: 0 }),
    ];
    expect([...items].sort(byPositionThenNewest).map((i) => i.id)).toEqual(["a", "b", "legacy", "unranked"]);
  });

  it("orders unranked rows newest-first among themselves", () => {
    const items = [
      item("old", { added_at: "2026-01-01T00:00:00Z", position: null }),
      item("new", { added_at: "2026-06-01T00:00:00Z", position: null }),
    ];
    expect([...items].sort(byPositionThenNewest).map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("breaks ties deterministically by id", () => {
    const items = [item("z"), item("a")];
    expect([...items].sort(byPositionThenNewest).map((i) => i.id)).toEqual(["a", "z"]);
  });
});

describe("moveItem", () => {
  it("moves an item up before the target", () => {
    expect(moveItem(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("moves an item down after the target when placeAfter", () => {
    expect(moveItem(["a", "b", "c", "d"], "a", "c", true)).toEqual(["b", "c", "a", "d"]);
  });

  it("inserts before the target by default when moving down", () => {
    expect(moveItem(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "a", "c", "d"]);
  });

  it("can move to first and last positions", () => {
    expect(moveItem(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op for identical or unknown ids", () => {
    const ids = ["a", "b", "c"];
    expect(moveItem(ids, "a", "a")).toBe(ids);
    expect(moveItem(ids, "x", "b")).toBe(ids);
    expect(moveItem(ids, "a", "x")).toBe(ids);
  });

  it("does not mutate the input array", () => {
    const ids = ["a", "b", "c"];
    moveItem(ids, "c", "a");
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
