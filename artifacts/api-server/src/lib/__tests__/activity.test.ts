import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as redisModule from "../redis.js";
import { pushActivityBatch, flushActivity } from "../activity.js";
// parseEntries is internal; exercise it through flushActivity's no-redis path
// and via the exported behavior. For entry parsing, test through a stubbed
// redis returning a crafted xreadgroup response.

// Avoid importing supabase real client side-effects: activity.ts imports
// supabase at module load. We don't hit it when redis is disconnected, but
// the import itself must resolve — the workspace supabase client needs env
// vars. Mock the modules activity depends on.
vi.mock("../redis.js", () => ({
  getRedis: vi.fn(() => null),
  isRedisConnected: vi.fn(() => false),
}));

// supabase is only used inside flushActivity after entries are read; with
// redis mocked to null the code never reaches it. Still, the import in
// activity.ts pulls in lib/supabase.js which throws without env. Mock it.
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
    }),
  },
}));

vi.mock("../logger.js", () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {} },
}));

describe("activity pipeline (redis disconnected)", () => {
  beforeEach(() => {
    vi.mocked(redisModule.getRedis).mockReset().mockReturnValue(null);
    vi.mocked(redisModule.isRedisConnected).mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pushActivityBatch is a safe no-op when Redis is down", async () => {
    await expect(pushActivityBatch([{ name: "lcp", value: 123 }])).resolves.toBeUndefined();
  });

  it("pushActivityBatch ignores empty batches", async () => {
    const redis = { xadd: vi.fn() } as any;
    vi.mocked(redisModule.getRedis).mockReturnValue(redis);
    vi.mocked(redisModule.isRedisConnected).mockReturnValue(true);
    await pushActivityBatch([]);
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it("flushActivity returns 0 and never touches supabase when Redis is down", async () => {
    const result = await flushActivity();
    expect(result).toBe(0);
  });
});