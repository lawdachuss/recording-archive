import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockRedis } from "../../test-utils/mock-redis.js";
import {
  bumpRecordingHot,
  getHotRecordings,
  getHotPerformers,
  getHotStats,
  clearHotCache,
  seedHotCache,
  type HotBumpMeta,
} from "../hot-cache.js";
import * as redis from "../redis.js";

vi.mock("../redis.js", () => ({
  getRedis: vi.fn(() => null),
  isRedisConnected: vi.fn(() => false),
  redisPublish: vi.fn(async () => 0),
  redisSubscribe: vi.fn(async () => () => {}),
}));

const { redis: fakeRedis, store } = createMockRedis();

function useRedis() {
  vi.mocked(redis.getRedis).mockReturnValue(fakeRedis);
  vi.mocked(redis.isRedisConnected).mockReturnValue(true);
}

const loader = vi.fn(async (): Promise<HotBumpMeta | null> => ({
  username: "alice",
  title: "Midnight Set",
  image_url: "https://cdn.example/alice.jpg",
}));

describe("hot cache", () => {
  beforeEach(() => {
    store.strings.clear();
    store.zsets.clear();
    store.hashes.clear();
    loader.mockClear();
    useRedis();
  });

  afterEach(() => {
    vi.mocked(redis.getRedis).mockReset();
    vi.mocked(redis.isRedisConnected).mockReset();
  });

  it("returns empty when Redis is unavailable", async () => {
    vi.mocked(redis.getRedis).mockReturnValue(null);
    await bumpRecordingHot("rec1", loader);
    expect(await getHotRecordings(10)).toEqual([]);
    expect(await getHotPerformers(10)).toEqual([]);
  });

  it("records a bump and reads it back with hydrated metadata", async () => {
    await bumpRecordingHot("rec1", loader);

    const hot = await getHotRecordings(10);
    expect(hot).toHaveLength(1);
    expect(hot[0]).toMatchObject({
      id: "rec1",
      username: "alice",
      title: "Midnight Set",
      image_url: "https://cdn.example/alice.jpg",
      score: 1,
    });

    const perfs = await getHotPerformers(10);
    expect(perfs).toHaveLength(1);
    expect(perfs[0]).toMatchObject({ username: "alice", score: 1 });
  });

  it("fetches metadata only once per recording", async () => {
    await bumpRecordingHot("rec1", loader);
    await bumpRecordingHot("rec1", loader);
    await bumpRecordingHot("rec1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    const hot = await getHotRecordings(10);
    expect(hot[0]?.score).toBe(3);
  });

  it("sorts by score descending", async () => {
    await bumpRecordingHot("rec1", loader);
    const loader2 = vi.fn(async (): Promise<HotBumpMeta | null> => ({
      username: "bob",
      title: "Late Night",
    }));
    for (let i = 0; i < 5; i++) await bumpRecordingHot("rec2", loader2);

    const hot = await getHotRecordings(10);
    expect(hot.map((h) => h.id)).toEqual(["rec2", "rec1"]);
    expect(hot.map((h) => h.score)).toEqual([5, 1]);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 6; i++) {
      const l = vi.fn(async () => ({ username: `perf-${i}`, title: null, image_url: null }) as HotBumpMeta);
      await bumpRecordingHot(`rec-${i}`, l);
    }
    expect(await getHotRecordings(3)).toHaveLength(3);
    expect(await getHotPerformers(2)).toHaveLength(2);
  });

  it("seeds from bulk data and reports stats", async () => {
    await seedHotCache(
      [
        { id: "a", username: "alice", title: "A", image_url: "a.jpg", viewers: 40 },
        { id: "b", username: "bob", title: "B", image_url: null, viewers: 10 },
      ],
      [{ username: "carol", image_url: "c.jpg", score: 5 }],
    );
    const hot = await getHotRecordings(10);
    expect(hot).toHaveLength(2);
    expect(hot[0]).toMatchObject({ id: "a", score: 40 });
    expect(hot[1]).toMatchObject({ id: "b", score: 10 });

    expect(await getHotStats()).toEqual({ recordings: 2, performers: 3 });
  });

  it("clears every trending key", async () => {
    await bumpRecordingHot("rec1", loader);
    expect(store.zsets.size).toBeGreaterThan(0);
    expect(await clearHotCache()).toBe(4);
    expect(store.zsets.size).toBe(0);
    expect(store.hashes.size).toBe(0);
  });
});