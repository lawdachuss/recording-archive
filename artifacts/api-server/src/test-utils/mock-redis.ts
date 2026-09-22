// mock-redis.ts — test double for the small slice of ioredis the cache
// libraries use. Each test creates a fresh instance via createMockRedis().
// Tracking of each command is exposed for assertions (`.log`).

class MockPipeline {
  commands: Array<{ cmd: string; args: any[] }> = [];
  constructor(private store: MockRedisStore) {}
  private record(cmd: string, args: any[]): this {
    this.commands.push({ cmd, args });
    return this;
  }
  get(key: string) { return this.record("get", [key]); }
  set(key: string, value: any) { return this.record("set", [key, value]); }
  setnx(key: string, value: any) { return this.record("setnx", [key, value]); }
  setex(key: string, ttl: number, value: any) { return this.record("setex", [key, ttl, value]); }
  expire(key: string, ttl: number) { return this.record("expire", [key, ttl]); }
  incr(key: string) { return this.record("incr", [key]); }
  decrby(key: string, by: number) { return this.record("decrby", [key, by]); }
  del(keys: any) { return this.record("del", [keys]); }
  zincrby(key: string, n: number, member: string) { return this.record("zincrby", [key, n, member]); }
  zadd(key: string, score: number, member: string) { return this.record("zadd", [key, score, member]); }
  zrem(key: string, members: string | string[]) { return this.record("zrem", [key, members]); }
  hset(key: string, field: string, value: any) { return this.record("hset", [key, field, value]); }
  hsetnx(key: string, field: string, value: any) { return this.record("hsetnx", [key, field, value]); }
  hget(key: string, field: string) { return this.record("hget", [key, field]); }
  hmget(key: string, fields: string[]) { return this.record("hmget", [key, fields]); }
  hexists(key: string, field: string) { return this.record("hexists", [key, field]); }
  zcard(key: string) { return this.record("zcard", [key]); }
  zscore(key: string, member: string) { return this.record("zscore", [key, member]); }
  zrange(key: string, start: number, stop: number) { return this.record("zrange", [key, start, stop]); }
  zrevrange(key: string, start: number, stop: number, withScores?: string) {
    return this.record("zrevrange", [key, start, stop, withScores]);
  }
  scan(cursor: string, ...rest: any[]) { return this.record("scan", [cursor, ...rest]); }

  async exec(): Promise<Array<[Error | null, any]>> {
    return this.commands.map(({ cmd, args }) => {
      try {
        return [null, this.store.run(cmd, args)];
      } catch (err) {
        return [err as Error, undefined];
      }
    });
  }
}

class MockRedisStore {
  log: Array<{ cmd: string; args: any[] }> = [];
  strings = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  zsets = new Map<string, Map<string, number>>();
  #pipeline = new Map<string, MockPipeline>();

  run(cmd: string, args: any[]): any {
    this.log.push({ cmd, args });
    switch (cmd) {
      case "get": {
        const [key] = args;
        return this.strings.get(key as string) ?? null;
      }
      case "set": {
        const [key, value, ...rest] = args;
        if (rest.includes("NX") && this.strings.has(key as string)) return null;
        this.strings.set(key as string, String(value ?? ""));
        return "OK";
      }
      case "setex": {
        const [key, , value] = args;
        this.strings.set(key as string, String(value));
        return "OK";
      }
      case "setnx": {
        const [key, value] = args;
        if (this.strings.has(key as string)) return 0;
        this.strings.set(key as string, String(value));
        return 1;
      }
      case "incr": {
        const [key] = args;
        const next = (this.#num(key) ?? 0) + 1;
        this.strings.set(key as string, String(next));
        return next;
      }
      case "decrby": {
        const [key, by] = args;
        const next = (this.#num(key) ?? 0) - Number(by);
        this.strings.set(key as string, String(next));
        return next;
      }
      case "del": {
        let removed = 0;
        for (const key of Array.isArray(args[0]) ? args[0] : args) {
          if (this.strings.delete(key)) removed++;
          if (this.hashes.delete(key)) removed++;
          if (this.zsets.delete(key)) removed++;
        }
        return removed;
      }
      case "expire": return 1;
      case "zadd": {
        const [key, score, member] = args;
        let set = this.zsets.get(key as string);
        if (!set) { set = new Map(); this.zsets.set(key as string, set); }
        set.set(member as string, Number(score));
        return 1;
      }
      case "zincrby": {
        const [key, n, member] = args;
        let set = this.zsets.get(key as string);
        if (!set) { set = new Map(); this.zsets.set(key as string, set); }
        const next = (set.get(member as string) ?? 0) + Number(n);
        set.set(member as string, next);
        return next;
      }
      case "zrevrange": {
        const [key, start, stop, withScores] = args;
        const set = this.zsets.get(key as string) ?? new Map();
        const sorted = [...set].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const slice = sorted.slice(Number(start), stop === -1 ? undefined : Number(stop) + 1);
        if (withScores === "WITHSCORES") {
          return slice.flatMap(([m, s]) => [m, String(s)]);
        }
        return slice.map(([m]) => m);
      }
      case "zrange": {
        const [key, start, stop] = args;
        const set = this.zsets.get(key as string) ?? new Map();
        const sorted = [...set].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
        const slice = sorted.slice(Number(start), stop === -1 ? undefined : Number(stop) + 1);
        return slice.map(([m]) => m);
      }
      case "zrem": {
        const [key, members] = args;
        const set = this.zsets.get(key as string);
        if (!set) return 0;
        let removed = 0;
        for (const m of Array.isArray(members) ? members : [members]) {
          if (set.delete(m)) removed++;
        }
        return removed;
      }
      case "zcard": {
        const [key] = args;
        return this.zsets.get(key as string)?.size ?? 0;
      }
      case "hset": {
        const [key, field, value] = args;
        let hash = this.hashes.get(key as string);
        if (!hash) { hash = new Map(); this.hashes.set(key as string, hash); }
        hash.set(field as string, String(value));
        return 1;
      }
      case "hget": {
        const [key, field] = args;
        return this.hashes.get(key as string)?.get(field as string) ?? null;
      }
      case "hmget": {
        const [key, fields] = args;
        const hash = this.hashes.get(key as string);
        return (fields as string[]).map((f) => hash?.get(f) ?? null);
      }
      case "hexists": {
        const [key, field] = args;
        return this.hashes.get(key as string)?.has(field as string) ? 1 : 0;
      }
      case "scan": {
        const [, , match, , , ...rest] = args; // ["0", "MATCH", pattern, "COUNT", count]
        const pattern = match as string;
        const limit = Number(rest[0] ?? 100);
        const glob = patternToRegExp(pattern);
        const keys = [...new Set([...this.strings.keys(), ...this.hashes.keys(), ...this.zsets.keys()])]
          .filter((k) => glob.test(k));
        return ["0", keys.slice(0, limit)];
      }
      case "publish": return 1;
      default:
        throw new Error(`mock redis: unsupported command ${cmd}`);
    }
  }

  #num(key: string): number | null {
    const raw = this.strings.get(key);
    if (raw === undefined) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  pipeline(): MockPipeline {
    const p = new MockPipeline(this as unknown as MockRedisStore);
    this.#pipeline.set(`${Math.random()}`, p);
    return p;
  }

  async exec() { return []; }
  async subscribe() {}
  async unsubscribe() {}
  async connect() {}
  status = "ready";
}

const COMMAND_METHODS = [
  "get", "set", "setex", "setnx", "incr", "decrby", "del", "expire",
  "zadd", "zincrby", "zrevrange", "zrange", "zrem", "zcard", "zscore",
  "hset", "hget", "hmget", "hexists", "scan", "publish",
] as const;

export function createMockRedis() {
  const store = new MockRedisStore();
  // The libs call redis.get()/zadd()/… directly; forward every command to the
  // store's run() dispatcher while letting pipeline()/status pass through.
  const redis = new Proxy(store, {
    get(target, prop, _receiver) {
      if (typeof prop === "string" && (COMMAND_METHODS as readonly string[]).includes(prop)) {
        return (...args: any[]) => target.run(prop, args);
      }
      // Bind methods to `target` (NOT the proxy): the class uses private
      // fields (#pipeline), which break when `this` is a Proxy.
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { store, redis };
}

export function patternToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}