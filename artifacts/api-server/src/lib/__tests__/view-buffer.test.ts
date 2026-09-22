import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockRedis } from "../../test-utils/mock-redis.js";
import {
  recordView,
  flushPendingViews,
  getViewBufferStats,
  clearViewBuffer,
} from "../view-buffer.js";
import * as redis from "../redis.js";
import { invalidateTags } from "../../middleware/cache.js";

// Shared Postgres state: viewers counts per recording + preseeded metadata.
const pg = vi.hoisted(() => ({
  viewers: new Map<string, number>(),
  meta: new Map<string, any>(), // recordings_with_links shape
  blockCas: false,
}));

vi.mock("../redis.js", () => ({
  getRedis: vi.fn(() => null),
  isRedisConnected: vi.fn(() => false),
  redisPublish: vi.fn(async () => 0),
  redisSubscribe: vi.fn(async () => () => {}),
}));

vi.mock("../../middleware/cache.js", () => ({
  invalidateTags: vi.fn(async () => {}),
}));

vi.mock("../supabase.js", () => {
  const terminal = (compute: () => { data: any; error: any }) => ({
    then: (resolve: (v: any) => any, reject: (e: unknown) => unknown) => {
      try {
        resolve(compute());
      } catch (err) {
        reject(err);
      }
    },
  });

  const findEq = (eqs: Array<[string, any]>, col: string): any =>
    eqs.find(([c]) => c === col)?.[1];

  const buildChain = (table: string) => {
    const state: any = {
      table,
      eqs: [] as Array<[string, any]>,
      updateObj: null as any,
    };
    const readSingle = () => {
      if (state.table === "recordings") {
        const id = findEq(state.eqs, "id");
        if (!pg.viewers.has(id)) return { data: null, error: null };
        return { data: { viewers: pg.viewers.get(id) }, error: null };
      }
      // recordings_with_links
      const id = findEq(state.eqs, "id");
      return { data: pg.meta.get(id) ?? null, error: null };
    };
    const casUpdate = () => {
      const id = findEq(state.eqs, "id") as string;
      const expected = findEq(state.eqs, "viewers") as number;
      if (!pg.blockCas && pg.viewers.get(id) === expected) {
        pg.viewers.set(id, state.updateObj.viewers as number);
        return { data: [{ id }], error: null };
      }
      return { data: [], error: null };
    };
    const q: any = {
      select: () => (state.updateObj ? terminal(casUpdate) : q),
      eq: (col: string, val: any) => {
        state.eqs.push([col, val]);
        return q;
      },
      not: () => q,
      order: () => q,
      update: (obj: any) => {
        state.updateObj = obj;
        return q;
      },
      maybeSingle: () => terminal(readSingle),
    };
    return q;
  };

  return {
    supabase: { from: (table: string) => buildChain(table) },
  };
});

const { redis: fakeRedis, store } = createMockRedis();

const waitMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

function useRedis() {
  vi.mocked(redis.getRedis).mockReturnValue(fakeRedis);
  vi.mocked(redis.isRedisConnected).mockReturnValue(true);
}

beforeEach(() => {
  store.strings.clear();
  store.zsets.clear();
  store.hashes.clear();
  pg.viewers.clear();
  pg.meta.clear();
  pg.blockCas = false;
  vi.clearAllMocks();
  useRedis();
});

afterEach(() => {
  vi.mocked(redis.getRedis).mockReset();
  vi.mocked(redis.isRedisConnected).mockReset();
});

describe("recordView", () => {
  it("returns null for the direct-PG fallback when Redis is down", async () => {
    vi.mocked(redis.getRedis).mockReturnValue(null);
    expect(await recordView("rec1")).toBeNull();
  });

  it("coalesces increments against the last-read PG value", async () => {
    pg.viewers.set("rec1", 100);
    expect(await recordView("rec1")).toBe(101);
    expect(await recordView("rec1")).toBe(102);
    expect(store.strings.get("views:pend:v1:rec1")).toBe("2");
    expect(store.strings.get("views:base:v1:rec1")).toBe("100");
    expect([...store.zsets.keys()]).toContain("views:changed:v1");
    expect(pg.viewers.get("rec1")).toBe(100); // PG untouched until flush
  });

  it("auto-flushes once the backlog crosses the threshold", async () => {
    pg.viewers.set("rec1", 100);
    pg.meta.set("rec1", {
      username: "alice",
      room_title: "Set",
      thumbnail_url: null,
    });

    for (let i = 0; i < 10; i++) {
      await recordView("rec1");
    }
    await waitMacrotask(); // drain async auto-flush

    expect(pg.viewers.get("rec1")).toBe(110); // written to PG via CAS
    expect(store.strings.has("views:pend:v1:rec1")).toBe(false); // drained
    expect(store.strings.get("views:base:v1:rec1")).toBe("110");
    expect(store.zsets.get("views:changed:v1")?.size).toBe(0);
    expect(invalidateTags).toHaveBeenCalledWith(["recordings", "stats"]);
  });
});

describe("flushPendingViews", () => {
  it("applies buffered increments across recordings and invalidates", async () => {
    pg.viewers.set("a", 10);
    pg.viewers.set("b", 20);
    await recordView("a");
    await recordView("a");
    await recordView("b");

    const result = await flushPendingViews();
    expect(result.scanned).toBe(2);
    expect(result.applied).toBe(3);
    expect(result.casMisses).toBe(0);
    expect(pg.viewers.get("a")).toBe(12);
    expect(pg.viewers.get("b")).toBe(21);
    expect(invalidateTags).toHaveBeenCalled();
  });

  it("skips recordings that no longer exist in PG", async () => {
    await recordView("ghost"); // no pg entry → setnx anchors to 0
    const result = await flushPendingViews();
    expect(result.deleted).toBe(1);
    expect(result.applied).toBe(0);
    expect(pg.viewers.has("ghost")).toBe(false);
  });

  it("re-anchors and retries later when the CAS misses (concurrent writer)", async () => {
    pg.viewers.set("a", 10);
    await recordView("a");
    await recordView("a"); // pend = 2, base = 10, pg = 10

    // Force the CAS filter to reject (simulates PG moving between our read
    // and our write — a racing writer or another flusher).
    pg.blockCas = true;

    const result = await flushPendingViews();
    expect(result.casMisses).toBe(1);
    expect(result.applied).toBe(0);
    expect(pg.viewers.get("a")).toBe(10); // untouched
    expect(store.strings.get("views:base:v1:a")).toBe("10"); // re-anchored
    expect(store.zsets.get("views:changed:v1")?.size).toBe(1); // still pending

    pg.blockCas = false;
    await flushPendingViews();
    expect(pg.viewers.get("a")).toBe(12); // backlog applied after unblock
  });
});

describe("stats + clear", () => {
  it("reports the pending backlog and can drop it", async () => {
    pg.viewers.set("a", 5);
    await recordView("a");
    await recordView("a");

    expect(await getViewBufferStats()).toEqual({ pendingRecordings: 1, enabled: true });
    expect(await clearViewBuffer()).toBeGreaterThan(0);
    expect(store.strings.size).toBe(0); // pend + base keys gone
    expect(store.zsets.has("views:changed:v1")).toBe(false); // backlog tracker gone
  });
});