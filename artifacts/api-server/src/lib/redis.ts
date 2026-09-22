// redis.ts — Redis client via ioredis (optional dependency)
// Gracefully degrades to null exports when ioredis is not installed.

import { logger } from "./logger.js";

function tryImportRedis(): any {
  try {
    return require("ioredis");
  } catch {
    return null;
  }
}

const redisUrl = process.env.REDIS_URL;
const httpUrl = process.env.REDIS_HTTP_URL;

let client: any = null;
let isConnected = false;
let httpMode = false;

// ─── HTTPS bridge client ───────────────────────────────────────────
// When REDIS_HTTP_URL is set we skip ioredis sockets entirely and talk to the
// self-hosted Redis through the permanent HTTPS bridge edge function
// (supabase-selfhosted/supabase/volumes/functions/redis-http). This is the
// permanent-Redis path for hosts that cannot run a TCP client plus cloudflared
// — most importantly Vercel serverless, where a raw redis:// URL can never be
// made permanent for free. No socket, no tunnel, no bore relay; the address
// never changes and the endpoint itself answers 503 + Retry-After while the
// stack is between sessions, so callers fail fast and fall back to Postgres.

const HTTP_TIMEOUT_MS = Number.parseInt(process.env.REDIS_HTTP_TIMEOUT_MS ?? "", 10) || 15_000;

function createHttpRedis(url: string, key: string) {
  const post = async (body: unknown): Promise<any> => {
    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: key },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      isConnected = false;
      logger.error({ err: { message: (err as any)?.message } }, "Redis HTTP bridge unreachable");
      throw err;
    }

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      isConnected = false;
      throw new Error(`Redis HTTP bridge returned ${res.status}`);
    }

    if (res.status === 503) {
      // Session gap — same contract as the bridge: fail fast, degrade to DB.
      isConnected = false;
      throw new Error("Redis unavailable (HTTP bridge 503)");
    }
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error ?? `Redis HTTP bridge error ${res.status}`);
    }
    isConnected = true;
    return payload;
  };

  const command = async (cmd: string, args: unknown[] = []): Promise<any> => {
    const payload = await post({ cmd, args });
    return payload.result;
  };

  const normalizeKeys = (args: unknown[]): unknown[] =>
    args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;

  const pipeline = () => {
    const ops: Array<{ cmd: string; args: unknown[] }> = [];
    const push = (cmd: string, args: unknown[]) => {
      ops.push({ cmd, args: normalizeKeys(args) });
      return outer;
    };
    const outer = {
      sadd: (k: string, v: string) => push("sadd", [k, v]),
      zincrby: (k: string, inc: number, m: string) => push("zincrby", [k, inc, m]),
      hset: (k: string, f: string, v: string) => push("hset", [k, f, v]),
      expire: (k: string, s: number) => push("expire", [k, s]),
      zadd: (k: string, score: number, m: string) => push("zadd", [k, score, m]),
      setex: (k: string, ttl: number, v: string) => push("setex", [k, ttl, v]),
      set: (k: string, v: string) => push("set", [k, v]),
      del: (keys: string | string[]) => push("del", [keys]),
      exec: async (): Promise<Array<[Error | null, any]>> => {
        const payload = await post({ pipeline: ops });
        const results: Array<[Error | null, any]> = [];
        for (const [err, result] of payload.results ?? []) {
          results.push([err ? new Error(String(err)) : null, err ? undefined : result]);
        }
        return results;
      },
    };
    return outer;
  };

  return {
    status: "ready",
    get: (k: string) => command("get", [k]),
    set: (k: string, v: string, ...rest: unknown[]) => command("set", [k, v, ...rest]),
    setex: (k: string, ttl: number, v: string) => command("setex", [k, ttl, v]),
    setnx: (k: string, v: string) => command("setnx", [k, v]),
    del: (...keys: unknown[]) => command("del", normalizeKeys(keys)),
    expire: (k: string, s: number) => command("expire", [k, s]),
    ttl: (k: string) => command("ttl", [k]),
    incr: (k: string) => command("incr", [k]),
    decrby: (k: string, by: number) => command("decrby", [k, by]),
    scan: (cursor: string, ...rest: unknown[]) => command("scan", [cursor, ...rest]),
    dbsize: () => command("dbsize"),
    smembers: (k: string) => command("smembers", [k]),
    sadd: (k: string, v: string) => command("sadd", [k, v]),
    hexists: (k: string, f: string) => command("hexists", [k, f]),
    hget: (k: string, f: string) => command("hget", [k, f]),
    hmget: (k: string, fields: string | string[]) =>
      command("hmget", [k, ...(Array.isArray(fields) ? fields : [fields])]),
    hset: (k: string, f: string, v: string) => command("hset", [k, f, v]),
    zadd: (k: string, s: number, m: string) => command("zadd", [k, s, m]),
    zincrby: (k: string, inc: number, m: string) => command("zincrby", [k, inc, m]),
    zrange: (k: string, start: number, stop: number) => command("zrange", [k, start, stop]),
    zrevrange: (k: string, start: number, stop: number, ...rest: unknown[]) =>
      command("zrevrange", [k, start, stop, ...rest]),
    zcard: (k: string) => command("zcard", [k]),
    zrem: (k: string, members: string | string[]) =>
      command("zrem", [k, ...(Array.isArray(members) ? members : [members])]),
    xadd: (k: string, id: string, ...rest: unknown[]) => command("xadd", [k, id, ...rest]),
    xtrim: (k: string, ...rest: unknown[]) => command("xtrim", [k, ...rest]),
    xgroup: (...args: unknown[]) => command("xgroup", args),
    xreadgroup: (...args: unknown[]) => command("xreadgroup", args),
    xack: (k: string, g: string, ...ids: unknown[]) => command("xack", [k, g, ...ids]),
    ping: () => command("ping"),
    pipeline,
  };
}

if (httpUrl) {
  httpMode = true;
  client = createHttpRedis(
    httpUrl,
    process.env.REDIS_HTTP_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  );
  isConnected = true;
  logger.info(`Redis over HTTPS bridge enabled (${httpUrl})`);
} else if (redisUrl) {
  const mod = tryImportRedis();
  if (!mod) {
    logger.warn("ioredis not available, Redis caching disabled");
  } else {
    const Redis = mod.Redis || mod;
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        // NEVER permanently give up. Redis is reached through a public tunnel
        // that blips intermittently; a connection failure during a blip must
        // not disable caching for this instance's whole lifetime. Cap the
        // backoff so a long outage doesn't hammer the tunnel, but keep
        // retrying so the client self-heals the moment it comes back.
        const delay = Math.min(250 * Math.pow(2, times - 1), 15_000);
        if (times % 10 === 0) {
          logger.warn({ attempt: times }, "Redis still reconnecting");
        }
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: true,
      commandTimeout: 5000,
      // Never queue commands while disconnected: with the never-give-up
      // retryStrategy above, the offline queue would buffer every command
      // issued during a tunnel blip and replay the whole backlog on
      // reconnect — stale writes racing newer ones. Fail fast instead and
      // let the callers' graceful-degradation paths handle it.
      enableOfflineQueue: false,
    });

    client.on("error", (err: unknown) => {
      isConnected = false;
      logger.error({ err: { message: (err as any).message, code: (err as any).code } }, "Redis error");
    });

    client.on("connect", () => {
      logger.info("Redis connecting…");
    });

    client.on("ready", () => {
      isConnected = true;
      logger.info("Redis ready");
    });

    client.on("close", () => {
      isConnected = false;
      logger.warn("Redis closed");
    });

    client.on("reconnecting", () => {
      logger.info("Redis reconnecting…");
    });

    client.connect().catch((err: unknown) => {
      logger.error({ err: { message: (err as any).message } }, "Redis initial connection failed");
    });
  }
} else {
  logger.warn("REDIS_URL not set, caching disabled");
}

export function getRedis(): typeof client {
  return client;
}

export function isRedisConnected(): boolean {
  return isConnected && client?.status === "ready";
}

export function getRedisStatus(): string {
  if (httpMode) return "http";
  return client?.status ?? "none";
}

// ─── Pub/Sub (cross-instance cache invalidation) ───────────────────────
// The main client is used for normal commands. Pub/Sub gets its OWN duplicate
// connection: `subscriber` is deliberately on a separate socket so subscribe()
// blocking/receive traffic never contends with the request command pipeline.
// Best-effort by design — on serverless runtimes the subscription dies with the
// invocation, and on self-hosted long-running servers it stays alive across
// requests. When an invalidation lands here from another instance, the local
// memory cache is dropped even though this instance never saw the write.

let _pubSubClient: any = null;
let _subscribeClient: any = null;
let _pubSubReady = false;

function ensurePubSubClient(): any | null {
  if (!client) return null;
  if (_pubSubClient) return _pubSubClient;
  try {
    const Redis = client.constructor;
    const duplicate = client.duplicate();
    _pubSubClient = duplicate;
    duplicate.on("ready", () => { _pubSubReady = true; });
    duplicate.on("close", () => { _pubSubReady = false; });
    duplicate.on("error", (err: unknown) => {
      _pubSubReady = false;
      logger.error({ err: { message: (err as any)?.message } }, "Redis pub/sub error");
    });
    duplicate.connect().catch((err: unknown) => {
      logger.error({ err: { message: (err as any)?.message } }, "Redis pub/sub connect failed");
    });
    return duplicate;
  } catch (err) {
    logger.warn({ err }, "Redis pub/sub client unavailable");
    return null;
  }
}

/**
 * Publish a message to a channel (fire-and-forget, fails open). Returns false
 * when Redis is unavailable so callers can skip the "remote" half of their work.
 */
export function redisPublish(channel: string, message: string): boolean {
  // Cross-instance pub/sub can't survive a stateless HTTP bridge (each Vercel
  // invocation is a fresh instance anyway). Callers already treat a false here
  // as "skip the remote half of invalidation".
  if (httpMode) return false;
  const pub = _pubSubClient ?? (client ? client : null);
  if (!pub || !isRedisConnected()) return false;
  try {
    pub.publish(channel, message).catch((err: unknown) =>
      logger.error({ err, channel }, "Redis publish failed"),
    );
    return true;
  } catch (err) {
    logger.error({ err, channel }, "Redis publish error");
    return false;
  }
}

export interface PubSubSubscription {
  unsubscribe(): void;
  active: boolean;
}

/**
 * Subscribe to a channel. The handler is invoked with the raw message payload
 * for EVERY message on the channel (this process may be the publisher too — the
 * caller decides how to de-dup by comparing payloads). Returns an object with
 * `unsubscribe()`; on failure (no Redis / no sub client / already subscribed)
 * active=false is returned so callers can skip wiring.
 */
export function redisSubscribe(
  channel: string,
  handler: (message: string) => void,
): PubSubSubscription {
  const sub = ensurePubSubClient();
  const noop: PubSubSubscription = {
    active: false,
    unsubscribe() { /* nothing to do */ },
  };
  if (httpMode) return noop;
  if (!sub) return noop;

  try {
    sub.subscribe(channel, (err: unknown) => {
      if (err) {
        logger.error({ err, channel }, "Redis subscribe failed");
      }
    });
    sub.on("message", (receivedChannel: string, message: string) => {
      if (receivedChannel === channel) {
        try {
          handler(message);
        } catch (err) {
          logger.error({ err, channel }, "Redis pub/sub handler error");
        }
      }
    });
    return {
      active: true,
      unsubscribe() {
        try {
          sub.unsubscribe(channel).catch(() => {});
        } catch { /* already closed */ }
      },
    };
  } catch (err) {
    logger.error({ err, channel }, "Redis subscribe setup error");
    return noop;
  }
}
