import { describe, expect, it } from "vitest";
import { filterTagsByQuery, sortTagsByCount, type TagCount } from "../tag-search";

const tags: TagCount[] = [
  { tag: "Behind The Scenes", count: 12 },
  { tag: "Music", count: 4 },
  { tag: "behind-the-scenes", count: 12 },
  { tag: "Café", count: 2 },
];

describe("filterTagsByQuery", () => {
  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(filterTagsByQuery(tags, "  BEHIND  ").map((tag) => tag.tag)).toEqual([
      "Behind The Scenes",
      "behind-the-scenes",
    ]);
  });

  it("normalizes Unicode compatibility and composed characters", () => {
    expect(filterTagsByQuery(tags, "café").map((tag) => tag.tag)).toEqual(["Café"]);
    expect(filterTagsByQuery([{ tag: "ＴＡＧ", count: 1 }], "tag")).toEqual([
      { tag: "ＴＡＧ", count: 1 },
    ]);
  });

  it("returns no results for an unmatched query", () => {
    expect(filterTagsByQuery(tags, "not-a-real-tag")).toEqual([]);
  });

  it("returns a new array for an empty query without mutating the source", () => {
    const result = filterTagsByQuery(tags, "  ");
    expect(result).toEqual(tags);
    expect(result).not.toBe(tags);
    expect(tags.map((tag) => tag.tag)).toEqual([
      "Behind The Scenes",
      "Music",
      "behind-the-scenes",
      "Café",
    ]);
  });

  it("ignores malformed rows and invalid counts instead of throwing", () => {
    const malformedRows: unknown[] = [
      null,
      undefined,
      {},
      { tag: "missing count" },
      { tag: 42, count: 10 },
      { tag: "infinite", count: Infinity },
      { tag: "not a number", count: Number.NaN },
      { tag: "negative", count: -1 },
      { tag: "string count", count: "5" },
      { tag: "   ", count: 2 },
      { tag: "Valid zero", count: 0 },
      { tag: "Valid match", count: 3 },
    ];

    expect(filterTagsByQuery(malformedRows, "match").map((tag) => tag.tag)).toEqual([
      "Valid match",
    ]);
    expect(filterTagsByQuery(malformedRows, "").map((tag) => tag.tag)).toEqual([
      "Valid zero",
      "Valid match",
    ]);
  });

  it("treats a malformed query payload as an empty query", () => {
    expect(filterTagsByQuery(tags, null)).toEqual(tags);
  });

  it("returns an empty list for a non-array payload", () => {
    expect(filterTagsByQuery({ tag: "not-an-array", count: 1 }, "tag")).toEqual([]);
  });
});

describe("sortTagsByCount", () => {
  it("sorts by count descending and breaks ties deterministically", () => {
    expect(sortTagsByCount(tags).map((tag) => tag.tag)).toEqual([
      "Behind The Scenes",
      "behind-the-scenes",
      "Music",
      "Café",
    ]);
  });

  it("does not mutate the input array", () => {
    const result = sortTagsByCount(tags);
    expect(result).not.toBe(tags);
    expect(tags[0].tag).toBe("Behind The Scenes");
  });

  it("drops malformed rows and invalid counts before sorting", () => {
    const malformedRows: unknown[] = [
      null,
      { tag: "missing count" },
      { tag: "   ", count: 4 },
      { tag: "infinite", count: Infinity },
      { tag: "negative", count: -2 },
      { tag: "valid lower", count: 1 },
      { tag: "valid higher", count: 9 },
    ];

    expect(sortTagsByCount(malformedRows).map((tag) => tag.tag)).toEqual([
      "valid higher",
      "valid lower",
    ]);
  });

  it("returns an empty list for a non-array payload", () => {
    expect(sortTagsByCount({ tag: "not-an-array", count: 1 })).toEqual([]);
  });
});
