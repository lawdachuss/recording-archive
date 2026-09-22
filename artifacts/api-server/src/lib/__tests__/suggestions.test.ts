import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockRedis } from "../../test-utils/mock-redis.js";
import {
  matchSuggestions,
  buildSuggestionSnapshot,
  maybeBuildSuggestionSnapshot,
  type SuggestionSnapshot,
} from "../suggestions.js";
import * as redis from "../redis.js";

const { demoRows, sampleSnapshot } = vi.hoisted(() => ({
  demoRows: Array.from({ length: 2500 }, (_, i) => ({
    id: `rec-${i}`,
    username: i % 2 === 0 ? "alice" : `perf-${i}`,
    tags: i % 3 === 0 ? ["pop", "modern"] : i % 3 === 1 ? ["rock"] : [],
    thumbnail_url: i % 2 === 0 ? null : `https://cdn.example/${i}.jpg`,
    sprite_url: null,
    room_title: `Title ${i}`,
    filename: `file-${i}.mp4`,
  })),
  sampleSnapshot: {
    builtAt: 1,
    performers: [
      { label: "alice" },
      { label: "alicewonder" },
      { label: "alice cooper" },
      { label: "bob" },
      { label: "alice2" },
      { label: "alice long one" },
    ],
    tags: ["pop", "rock", "modern", "jazz", "punk", "alts"],
    recordings: [
      { id: "r1", username: "alice", haystack: "alice good times", label: "Good Times", image_url: null },
      { id: "r2", username: "bob", haystack: "bob alice mashup", label: "Mashup", image_url: null },
      { id: "r3", username: "charlie", haystack: "sunny alice road", label: "Road", image_url: null },
      { id: "r4", username: "dave", haystack: "alice at night", label: "Night", image_url: null },
      { id: "r5", username: "erin", haystack: "alice remix x", label: "Remix", image_url: null },
      { id: "r6", username: "fran", haystack: "nothing", label: "No Match", image_url: null },
    ],
  } as SuggestionSnapshot,
}));

vi.mock("../redis.js", () => ({
  getRedis: vi.fn(() => null),
  isRedisConnected: vi.fn(() => false),
  redisPublish: vi.fn(async () => 0),
  redisSubscribe: vi.fn(async () => () => {}),
}));

vi.mock("../hot-cache.js", () => ({
  seedHotCache: vi.fn(async () => {}),
}));

vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === "recordings_with_links" ? demoRows : [];
      const query: any = {};
      query.select = () => query;
      query.not = () => query;
      query.order = () => query;
      query.range = (start: number, end: number) =>
        Promise.resolve({ data: rows.slice(start, end + 1), error: null });
      query.limit = (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null });
      return query;
    },
  },
  fetchAll: async (build: (start: number, end: number) => PromiseLike<{ data: any[] | null; error: unknown }>, pageSize = 1000) => {
    const all: any[] = [];
    let start = 0;
    for (;;) {
      const { data, error } = await build(start, start + pageSize - 1);
      if (error) return { data: null, error };
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      start += pageSize;
    }
    return { data: all, error: null };
  },
}));

// Fake Redis instance (post-init, injected via spyOn below).
const { redis: fakeRedis, store } = createMockRedis();

describe("matchSuggestions", () => {
  it("returns nothing for queries under 2 characters", () => {
    expect(matchSuggestions("a", sampleSnapshot)).toEqual([]);
    expect(matchSuggestions("", sampleSnapshot)).toEqual([]);
  });

  it("matches case-insensitively across all three categories", () => {
    const out = matchSuggestions("ALICE", sampleSnapshot);
    expect(out.some((s) => s.type === "performer")).toBe(true);
    expect(out.some((s) => s.type === "recording")).toBe(true);
    expect(out.map((s) => s.label)).toEqual(expect.arrayContaining(["alice", "Good Times"]));
  });

  it("caps each category at 4 results", () => {
    const out = matchSuggestions("alice", sampleSnapshot);
    expect(out.filter((s) => s.type === "performer")).toHaveLength(4);
    expect(out.filter((s) => s.type === "recording")).toHaveLength(4);
  });

  it("leaves unused categories out entirely", () => {
    const out = matchSuggestions("jazz", sampleSnapshot);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "tag", label: "jazz" });
  });

  it("puts tag results at the end with a browse href", () => {
    const out = matchSuggestions("mod", sampleSnapshot);
    expect(out[0]).toMatchObject({ type: "tag", label: "modern", href: "/browse?tags=modern" });
  });

  it("matches recordings via their haystack field", () => {
    const out = matchSuggestions("nothing", sampleSnapshot);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "recording", label: "No Match" });
  });
});

describe("buildSuggestionSnapshot", () => {
  beforeEach(() => {
    store.strings.clear();
    store.zsets.clear();
    store.hashes.clear();
    vi.mocked(redis.getRedis).mockReturnValue(fakeRedis);
    vi.mocked(redis.isRedisConnected).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(redis.getRedis).mockReset();
    vi.mocked(redis.isRedisConnected).mockReset();
  });

  it("builds, caps, sorts and persists a snapshot", async () => {
    const result = await buildSuggestionSnapshot();
    expect(result.ok).toBe(true);
    expect(result.performers).toBe(1251); // alice + 1250 unique perf-N rows
    expect(result.recordings).toBe(2000); // capped by MAX_RECORDINGS

    const raw = store.strings.get("sugg:v1:snapshot");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as SuggestionSnapshot;
    expect(parsed.performers).toHaveLength(1251);
    expect([...parsed.tags].sort()).toEqual(["modern", "pop", "rock"]);
  });

  it("degrades without Redis: computes but persists nothing", async () => {
    vi.mocked(redis.getRedis).mockReturnValue(null);
    const result = await buildSuggestionSnapshot();
    expect(result.ok).toBe(true);
    expect(result.performers).toBe(1251);
    expect(store.strings.size).toBe(0);
  });
});

describe("maybeBuildSuggestionSnapshot", () => {
  beforeEach(() => {
    store.strings.clear();
    store.zsets.clear();
    store.hashes.clear();
    vi.clearAllMocks();
    vi.mocked(redis.getRedis).mockReturnValue(fakeRedis);
    vi.mocked(redis.isRedisConnected).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(redis.getRedis).mockReset();
    vi.mocked(redis.isRedisConnected).mockReset();
  });

  it("skips building when another instance holds the lock", async () => {
    store.strings.set("sugg:v1:build-lock", "1");
    const { seedHotCache } = await import("../hot-cache.js");
    await maybeBuildSuggestionSnapshot();
    expect(seedHotCache).not.toHaveBeenCalled();
  });

  it("builds when the lock is free and nothing is cached", async () => {
    const { seedHotCache } = await import("../hot-cache.js");
    await maybeBuildSuggestionSnapshot();
    expect(seedHotCache).toHaveBeenCalled();
    expect(store.strings.has("sugg:v1:snapshot")).toBe(true);
  });
});