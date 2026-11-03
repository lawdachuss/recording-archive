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
});
