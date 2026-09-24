import { describe, it, expect, beforeEach, vi } from "vitest";
import type { QueueAdvanceDeps, QueueItem } from "../play-queue";

// ─── Browser stubs (vitest runs in the node environment) ──────────

const store = new Map<string, string>();

const sessionStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const dispatchEvent = vi.fn();
const addEventListener = vi.fn();
const removeEventListener = vi.fn();

vi.stubGlobal("window", {
  sessionStorage: sessionStorageStub,
  dispatchEvent,
  addEventListener,
  removeEventListener,
});

vi.stubGlobal(
  "CustomEvent",
  class CustomEventPolyfill<T> {
    readonly type: string;
    readonly detail: T | undefined;
    constructor(type: string, init?: { detail?: T }) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
);

let mod: typeof import("../play-queue");

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  username: `user_${id}`,
  room_title: `room ${id}`,
  thumbnail_url: `https://cdn.example/${id}.jpg`,
  duration: 120,
  timestamp: "2026-01-01T00:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  store.clear();
  dispatchEvent.mockClear();
  addEventListener.mockClear();
  removeEventListener.mockClear();
  vi.resetModules();
  mod = await import("../play-queue");
});

// ─── Tests ─────────────────────────────────────────────────────────

describe("play-queue", () => {
  describe("setQueue / getQueue", () => {
    it("round-trips a queue through sessionStorage", () => {
      const items = [mod.toQueueItem(rec("a")), mod.toQueueItem(rec("b"))].filter(
        (it): it is QueueItem => it !== null,
      );
      const saved = mod.setQueue("Trending Now", items);
      expect(saved).not.toBeNull();
      expect(saved!.title).toBe("Trending Now");

      const loaded = mod.getQueue();
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe("Trending Now");
      expect(loaded!.items.map((i) => i.id)).toEqual(["a", "b"]);
      expect(loaded!.items[0].username).toBe("user_a");
      expect(loaded!.items[0].duration).toBe(120);
    });

    it("replaces an existing queue", () => {
      mod.setQueue("First", [mod.toQueueItem(rec("a"))!]);
      mod.setQueue("Second", [mod.toQueueItem(rec("c"))!]);
      const loaded = mod.getQueue();
      expect(loaded!.title).toBe("Second");
      expect(loaded!.items.map((i) => i.id)).toEqual(["c"]);
    });

    it("drops items without a usable id", () => {
      const saved = mod.setQueue("Messy", [
        mod.toQueueItem(rec("ok"))!,
        mod.toQueueItem({ id: "" })!,
        { id: "", username: "x" }, // invalid shape bypassing toQueueItem
      ] as QueueItem[]);
      expect(saved).not.toBeNull();
      expect(saved!.items.map((i) => i.id)).toEqual(["ok"]);
      expect(mod.getQueue()!.items).toHaveLength(1);
    });

    it("clears instead of storing when no valid items remain", () => {
      mod.setQueue("Populated", [mod.toQueueItem(rec("a"))!]);
      const result = mod.setQueue("Empty", [{ id: "", username: "" }]);
      expect(result).toBeNull();
      expect(mod.getQueue()).toBeNull();
    });

    it("deduplicates items by id, keeping the first occurrence", () => {
      const saved = mod.setQueue(
        "Dupey",
        [mod.toQueueItem(rec("a"))!, mod.toQueueItem(rec("b"))!, mod.toQueueItem(rec("a"))!, mod.toQueueItem(rec("c"))!],
      );
      expect(saved!.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
      expect(mod.getQueue()!.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    });

    it("starts new queues unlooped even if the previous one was looping", () => {
      mod.setQueue("Looped", [mod.toQueueItem(rec("a"))!]);
      mod.setQueueLoop(true);
      expect(mod.getQueue()!.loop).toBe(true);
      mod.setQueue("Fresh", [mod.toQueueItem(rec("b"))!]);
      expect(mod.getQueue()!.loop).toBe(false);
    });

    it("caps the queue at MAX_ITEMS", () => {
      const many = Array.from({ length: 250 }, (_, i) => mod.toQueueItem(rec(`id-${i}`))!);
      const saved = mod.setQueue("Huge", many);
      expect(saved!.items).toHaveLength(200);
      expect(mod.getQueue()!.items).toHaveLength(200);
    });

    it("returns null for corrupt JSON", () => {
      store.set("vault-play-queue", "{not json");
      expect(mod.getQueue()).toBeNull();
    });

    it("returns null for structurally-valid JSON with no items", () => {
      store.set("vault-play-queue", JSON.stringify({ title: "x", items: [], createdAt: 1 }));
      expect(mod.getQueue()).toBeNull();
      store.set("vault-play-queue", JSON.stringify({ title: "x", createdAt: 1 }));
      expect(mod.getQueue()).toBeNull();
    });

    it("deduplicates on read and tolerates a loop flag", () => {
      const item = (id: string) => JSON.stringify(mod.toQueueItem(rec(id)));
      store.set(
        "vault-play-queue",
        `{"title":"x","createdAt":1,"loop":true,"items":[${item("a")},${item("b")},${item("a")}]}`,
      );
      const loaded = mod.getQueue()!;
      expect(loaded.items.map((i) => i.id)).toEqual(["a", "b"]);
      expect(loaded.loop).toBe(true);
    });

    it("preserves an absent loop flag as false", () => {
      store.set(
        "vault-play-queue",
        JSON.stringify({ title: "x", createdAt: 1, items: [mod.toQueueItem(rec("a"))] }),
      );
      expect(mod.getQueue()!.loop).toBe(false);
    });
  });

  describe("setQueueLoop", () => {
    it("toggles loop on the stored queue and notifies", () => {
      mod.setQueue("Mix", [mod.toQueueItem(rec("a"))!]);
      expect(mod.setQueueLoop(true)!.loop).toBe(true);
      expect(mod.getQueue()!.loop).toBe(true);
      expect(dispatchEvent).toHaveBeenCalledTimes(2); // set + loop toggle
      expect(mod.setQueueLoop(false)!.loop).toBe(false);
      expect(mod.getQueue()!.loop).toBe(false);
    });

    it("is a no-op without an active queue", () => {
      expect(mod.setQueueLoop(true)).toBeNull();
      expect(mod.getQueue()).toBeNull();
    });
  });

  describe("nextQueueItem", () => {
    const makeQueue = (ids: string[], loop = false) => ({
      title: "Mix",
      items: ids.map((id) => mod.toQueueItem(rec(id))!),
      createdAt: 1,
      loop,
    });

    it("returns the in-order next item", () => {
      expect(mod.nextQueueItem(makeQueue(["a", "b", "c"]), "b")!.id).toBe("c");
    });

    it("wraps to the first item at the end when loop is on", () => {
      expect(mod.nextQueueItem(makeQueue(["a", "b"], true), "b")!.id).toBe("a");
    });

    it("replays the only item in a one-item looped queue", () => {
      expect(mod.nextQueueItem(makeQueue(["a"], true), "a")!.id).toBe("a");
    });

    it("returns null at the end when loop is off", () => {
      expect(mod.nextQueueItem(makeQueue(["a", "b"]), "b")).toBeNull();
    });

    it("returns null for unknown ids, empty queues, or missing currentId", () => {
      expect(mod.nextQueueItem(makeQueue(["a"]), "zzz")).toBeNull();
      expect(mod.nextQueueItem(makeQueue([]), "a")).toBeNull();
      expect(mod.nextQueueItem(null, "a")).toBeNull();
      expect(mod.nextQueueItem(makeQueue(["a"]), null)).toBeNull();
    });
  });

  describe("shuffleQueueItems", () => {
    it("keeps the pinned first item first and shuffles the rest", () => {
      const items = ["a", "b", "c", "d", "e"].map((id) => mod.toQueueItem(rec(id))!);
      const out = mod.shuffleQueueItems(items, "a");
      expect(out[0].id).toBe("a");
      expect(out).toHaveLength(items.length);
      // Same multiset of ids — nothing lost, nothing invented.
      expect([...out].map((i) => i.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("shuffles everything when no first id is given", () => {
      const items = ["a", "b", "c", "d", "e", "f"].map((id) => mod.toQueueItem(rec(id))!);
      const out = mod.shuffleQueueItems(items);
      expect(out).toHaveLength(items.length);
      expect([...out].map((i) => i.id).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    });

    it("does not mutate the input array", () => {
      const items = ["a", "b", "c"].map((id) => mod.toQueueItem(rec(id))!);
      const before = items.map((i) => i.id);
      mod.shuffleQueueItems(items, "a");
      expect(items.map((i) => i.id)).toEqual(before);
    });

    it("handles a one-item queue and an unknown pinned id", () => {
      const single = [mod.toQueueItem(rec("a"))!];
      expect(mod.shuffleQueueItems(single, "a")).toEqual(single);
      const items = [mod.toQueueItem(rec("a"))!, mod.toQueueItem(rec("b"))!];
      const out = mod.shuffleQueueItems(items, "zzz");
      expect(out).toHaveLength(2);
      expect([...out].map((i) => i.id).sort()).toEqual(["a", "b"]);
    });
  });

  describe("clearQueue", () => {
    it("removes the stored queue", () => {
      mod.setQueue("Something", [mod.toQueueItem(rec("a"))!]);
      expect(mod.getQueue()).not.toBeNull();
      mod.clearQueue();
      expect(mod.getQueue()).toBeNull();
    });
  });

  describe("notifications", () => {
    it("dispatches the changed event on set and clear", () => {
      expect(dispatchEvent).not.toHaveBeenCalled();
      mod.setQueue("Mix", [mod.toQueueItem(rec("a"))!]);
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0][0].type).toBe(mod.QUEUE_CHANGED_EVENT);
      mod.clearQueue();
      expect(dispatchEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscribeQueue", () => {
    it("attaches custom + storage listeners and detaches on unsubscribe", () => {
      const unsub = mod.subscribeQueue(() => {});
      expect(addEventListener).toHaveBeenCalledWith(
        mod.QUEUE_CHANGED_EVENT,
        expect.any(Function),
      );
      expect(addEventListener).toHaveBeenCalledWith("storage", expect.any(Function));
      unsub();
      expect(removeEventListener).toHaveBeenCalledWith(
        mod.QUEUE_CHANGED_EVENT,
        expect.any(Function),
      );
      expect(removeEventListener).toHaveBeenCalledWith("storage", expect.any(Function));
    });
  });

  describe("toQueueItem", () => {
    it("maps recording fields onto queue items", () => {
      const item = mod.toQueueItem(rec("abc"));
      expect(item).toEqual({
        id: "abc",
        username: "user_abc",
        room_title: "room abc",
        thumbnail_url: "https://cdn.example/abc.jpg",
        duration: 120,
        timestamp: "2026-01-01T00:00:00.000Z",
      });
    });

    it("rejects objects without an id", () => {
      expect(mod.toQueueItem({ username: "nope" })).toBeNull();
      expect(mod.toQueueItem({ id: "" })).toBeNull();
    });

    it("tolerates missing optional fields", () => {
      const item = mod.toQueueItem({ id: "x" });
      expect(item).toEqual({
        id: "x",
        username: "",
        room_title: null,
        thumbnail_url: null,
        duration: null,
        timestamp: undefined,
      });
    });
  });

  describe("queueHref", () => {
    it("builds the video route for an item", () => {
      expect(mod.queueHref({ id: "abc", username: "u" })).toBe("/video/abc");
    });
  });

  describe("advanceQueue", () => {
    const makeQueue = (ids: string[]) => ({
      title: "Mix",
      items: ids.map((id) => mod.toQueueItem(rec(id))!),
      createdAt: 1,
    });

    const makeDeps = () => {
      const calls: unknown[][] = [];
      const deps: QueueAdvanceDeps = {
        navigate: (href) => void calls.push(["navigate", href]),
        scrollToTop: () => void calls.push(["scrollToTop"]),
        track: (event, meta) => void calls.push(["track", event, meta]),
      };
      return { calls, deps };
    };

    it("reports, scrolls to top, then navigates to the next queued item", () => {
      const { calls, deps } = makeDeps();
      expect(mod.advanceQueue(makeQueue(["a", "b", "c"]), "a", deps)).toBe(true);
      expect(calls).toEqual([
        ["track", "queue_advance", { queue_title: "Mix", recording_id: "b" }],
        ["scrollToTop"],
        ["navigate", "/video/b"],
      ]);
    });

    it("advances from any position, not just the first item", () => {
      const { calls, deps } = makeDeps();
      expect(mod.advanceQueue(makeQueue(["a", "b", "c"]), "b", deps)).toBe(true);
      expect(calls.at(-1)).toEqual(["navigate", "/video/c"]);
    });

    it("is a no-op at the end of the queue", () => {
      const { calls, deps } = makeDeps();
      expect(mod.advanceQueue(makeQueue(["a", "b"]), "b", deps)).toBe(false);
      expect(calls).toEqual([]);
    });

    it("wraps to the first item at the end when the queue loops", () => {
      const { calls, deps } = makeDeps();
      const q = { ...makeQueue(["a", "b"]), loop: true };
      expect(mod.advanceQueue(q, "b", deps)).toBe(true);
      expect(calls.at(-1)).toEqual(["navigate", "/video/a"]);
    });

    it("replays the single item in a one-item looped queue", () => {
      const { calls, deps } = makeDeps();
      const q = { ...makeQueue(["a"]), loop: true };
      expect(mod.advanceQueue(q, "a", deps)).toBe(true);
      expect(calls.at(-1)).toEqual(["navigate", "/video/a"]);
    });

    it("is a no-op when the current recording is not queued", () => {
      const { calls, deps } = makeDeps();
      expect(mod.advanceQueue(makeQueue(["a", "b"]), "zzz", deps)).toBe(false);
      expect(calls).toEqual([]);
    });

    it("is a no-op without a queue", () => {
      const { calls, deps } = makeDeps();
      expect(mod.advanceQueue(null, "a", deps)).toBe(false);
      expect(mod.advanceQueue(undefined, null, deps)).toBe(false);
      expect(calls).toEqual([]);
    });
  });
});
