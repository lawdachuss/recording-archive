import { describe, expect, it, vi } from "vitest";
import {
  clearRecentSearches,
  readRecentSearches,
  rememberRecentSearch,
} from "../recent-searches";

function createStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
    read: () => value,
  };
}

describe("recent search history", () => {
  it("normalizes, deduplicates, and caps malformed stored entries", () => {
    const storage = createStorage(JSON.stringify([
      "  Music   Videos ",
      null,
      "",
      "music videos",
      42,
      "Unicode café",
      "Performer",
      "Tag",
      "Extra",
    ]));

    expect(readRecentSearches(storage)).toEqual([
      "Music Videos",
      "Unicode café",
      "Performer",
      "Tag",
      "Extra",
    ]);
  });

  it("returns an empty list for malformed JSON or non-array storage", () => {
    expect(readRecentSearches(createStorage("{broken"))).toEqual([]);
    expect(readRecentSearches(createStorage(JSON.stringify({ search: "private" })))).toEqual([]);
  });

  it("moves a case-insensitive duplicate to the front and keeps five entries", () => {
    const storage = createStorage(JSON.stringify(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]));

    const result = rememberRecentSearch("  BRAVO   ", storage);

    expect(result).toEqual(["BRAVO", "Alpha", "Charlie", "Delta", "Echo"]);
    expect(JSON.parse(storage.read() || "[]")).toEqual(result);
  });

  it("does not persist an empty search term", () => {
    const storage = createStorage(JSON.stringify(["Existing"]));

    expect(rememberRecentSearch("   ", storage)).toEqual(["Existing"]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("clears the stored history without changing the active search", () => {
    const storage = createStorage(JSON.stringify(["Private search"]));

    clearRecentSearches(storage);

    expect(storage.removeItem).toHaveBeenCalledWith("vault_recent_searches");
    expect(readRecentSearches(storage)).toEqual([]);
  });

  it("degrades safely when browser storage is unavailable", () => {
    const blockedStorage = {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); },
      removeItem: () => { throw new Error("storage blocked"); },
    };

    expect(readRecentSearches(null)).toEqual([]);
    expect(rememberRecentSearch("local only", null)).toEqual(["local only"]);
    expect(() => readRecentSearches(blockedStorage)).not.toThrow();
    expect(() => rememberRecentSearch("term", blockedStorage)).not.toThrow();
    expect(() => clearRecentSearches(blockedStorage)).not.toThrow();
  });
});
