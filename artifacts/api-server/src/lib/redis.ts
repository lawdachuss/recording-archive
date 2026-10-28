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

// Vercel serverless functions fan out across many short-lived instances.
// VERCEL_CACHE_LOCAL_ONLY disables shared *response/media caches*, which are
// better served by Vercel/Cloudflare's CDN and per-instance cache. Keep the
// HTTPS Redis bridge available for feature state such as buffered view counts
// and activity streams; do not use the ephemeral bore.pub TCP URL on Vercel.
const vercelLocalCacheMode = process.env.VERCEL_CACHE_LOCAL_ONLY === "1";
const redisUrl = vercelLocalCacheMode ? undefined : process.env.REDIS_URL;
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

// Keep bursty cache traffic from opening hundreds of concurrent HTTPS
// connections to the self-hosted edge function on a small Render instance.
const HTTP_TIMEOUT_MS =
  Number.parseInt(process.env.REDIS_HTTP_TIMEOUT_MS ?? "", 10) || 2_500;
const HTTP_MAX_CONCURRENCY =
  Math.max(1, Number.parseInt(process.env.REDIS_HTTP_MAX_CONCURRENCY ?? "", 10) || 8);
const HTTP_MAX_QUEUE =
  Math.max(1, Number.parseInt(process.env.REDIS_HTTP_MAX_QUEUE ?? "", 10) || 64);
const HTTP_FAILURE_COOLDOWN_MS =
  Math.max(500, Number.parseInt(process.env.REDIS_HTTP_FAILURE_COOLDOWN_MS ?? "", 10) || 15_000);

let httpInFlight = 0;
let httpCircuitOpenUntil = 0;
let httpHalfOpenInFlight = false;
type HttpWaiter = {
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: Error) => void;
  onAbort: () => void;
};
const httpWaiters: HttpWaiter[] = [];

async function withHttpSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error("Redis HTTP bridge request timed out before acquiring a slot");

  if (httpInFlight >= HTTP_MAX_CONCURRENCY) {
    if (httpWaiters.length >= HTTP_MAX_QUEUE) {
      throw new Error("Redis HTTP bridge queue is full");
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = {} as HttpWaiter;
      waiter.signal = signal;
      waiter.resolve = () => {
        signal.removeEventListener("abort", waiter.onAbort);
        resolve();
      };
      waiter.reject = (error) => {
        signal.removeEventListener("abort", waiter.onAbort);
        reject(error);
      };
      waiter.onAbort = () => {
        const index = httpWaiters.indexOf(waiter);
        if (index >= 0) httpWaiters.splice(index, 1);
        waiter.reject(new Error("Redis HTTP bridge queue wait timed out"));
      };
      httpWaiters.push(waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal.aborted) waiter.onAbort();
    });
  } else {
    httpInFlight++;
  }

  try {
    if (signal.aborted) throw new Error("Redis HTTP bridge request timed out while queued");
    return await work();
  } finally {
    const next = httpWaiters.shift();
    if (next) {
      // Transfer the slot directly; the in-flight count remains unchanged.
      next.resolve();
    } else {
      httpInFlight--;
    }
  }
}

function openHttpCircuit(): void {
  isConnected = false;
  httpCircuitOpenUntil = Date.now() + HTTP_FAILURE_COOLDOWN_MS;
  httpHalfOpenInFlight = false;
}

function createHttpRedis(url: string, key: string) {
  const post = async (body: unknown): Promise<any> => {
    if (Date.now() < httpCircuitOpenUntil) {
      isConnected = false;
      throw new Error("Redis HTTP bridge is cooling down after a connection failure");
    }

    // After a failure, allow only one request to probe the bridge once the
    // cooldown expires. This prevents every concurrent cold start from
    // stampeding the same unhealthy endpoint.
    const isHalfOpenProbe = httpCircuitOpenUntil > 0;
    if (isHalfOpenProbe) {
      if (httpHalfOpenInFlight) {
        throw new Error("Redis HTTP bridge recovery probe is already in flight");
      }
      httpHalfOpenInFlight = true;
    }

    const controller = new AbortController();
    // Start the deadline before waiting for a concurrency slot so a queued
    // Redis operation cannot outlive the API request that initiated it.
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      return await withHttpSlot(controller.signal, async () => {
        if (Date.now() < httpCircuitOpenUntil) {
          isConnected = false;
          throw new Error("Redis HTTP bridge is cooling down after a connection failure");
        }

        let receivedResponse = false;
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", apikey: key },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          receivedResponse = true;

          const contentType = res.headers.get("content-type") ?? "";
          if (!contentType.toLowerCase().includes("json")) {
            // Cloudflare tunnel failures often return an HTML 502/530 page.
            // Treat it as an upstream outage, not a malformed Redis payload.
            openHttpCircuit();
            throw new Error(
              `Redis HTTP bridge returned HTTP ${res.status} (${contentType || "unknown content type"}; expected JSON)`,
            );
          }

          let payload: any;
          try {
            payload = await res.json();
          } catch {
            openHttpCircuit();
            throw new Error(
              `Redis HTTP bridge returned HTTP ${res.status} with invalid JSON (${contentType})`,
            );
          }

          if (res.status === 503) {
            openHttpCircuit();
            throw new Error("Redis unavailable (HTTP bridge 503)");
          }
          if (!res.ok || !payload?.ok) {
            const detail = typeof payload?.details === "string" ? payload.details : "";
            const message = typeof payload?.error === "string" ? payload.error : "";
            // Redis command-level replies (especially BUSYGROUP when a stream
            // consumer group already exists) do not mean the bridge is down.
            // Older bridge builds wrap the reply in HTTP 500; preserve the real
            // message and avoid tripping the circuit breaker for that case.
            const isExistingGroup =
              /^BUSYGROUP\\b/i.test(detail) || /^BUSYGROUP\\b/i.test(message);
            if (res.status >= 500 && !isExistingGroup) openHttpCircuit();
            throw new Error(
              detail && message && detail !== message
                ? `${message}: ${detail}`
                : detail || message || `Redis HTTP bridge error ${res.status}`,
            );
          }

          isConnected = true;
          httpCircuitOpenUntil = 0;
          return payload;
        } catch (err) {
          if (!receivedResponse) {
            openHttpCircuit();
            logger.error(
              { err: { message: (err as any)?.message }, timeoutMs: HTTP_TIMEOUT_MS },
              "Redis HTTP bridge unreachable",
            );
          }
          throw err;
        }
      });
    } finally {
      clearTimeout(timer);
      if (isHalfOpenProbe) httpHalfOpenInFlight = false;
    }
  };
  const MAX_HTTP_ARGS = 32;
  const MAX_HTTP_PIPELINE_OPS = 256;

  const executeBatch = async (
    commands: Array<{ cmd: string; args: unknown[] }>,
  ): Promise<any[]> => {
    const results: any[] = [];
    for (let i = 0; i < commands.length; i += MAX_HTTP_PIPELINE_OPS) {
      const payload = await post({
        pipeline: commands.slice(i, i + MAX_HTTP_PIPELINE_OPS),
      });
      for (const [err, result] of payload.results ?? []) {
        if (err) throw new Error(`Redis HTTP pipeline command failed: ${String(err)}`);
        results.push(result);
      }
    }
    return results;
  };

  const chunks = <T,>(values: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
    return out;
  };

  const command = async (cmd: string, args: unknown[] = []): Promise<any> => {
    if (args.length <= MAX_HTTP_ARGS) {
      const payload = await post({ cmd, args });
      return payload.result;
    }

    // The self-hosted bridge limits each command to 32 arguments. Redis
    // operations with a variadic tail can be split without changing meaning.
    // Use HTTP pipelines to keep this to one request for up to 256 chunks.
    const canonical = cmd.toUpperCase();
    if (canonical === "DEL" || canonical === "SADD" || canonical === "ZREM") {
      const [key, ...values] = args;
      const tailChunks = chunks(values, MAX_HTTP_ARGS - 1);
      const replies = await executeBatch(
        tailChunks.map((tail) => ({ cmd, args: [key, ...tail] })),
      );
      return replies.reduce((total, value) => total + Number(value ?? 0), 0);
    }

    if (canonical === "HMGET") {
      const [key, ...fields] = args;
      const fieldChunks = chunks(fields, MAX_HTTP_ARGS - 1);
      const replies = await executeBatch(
        fieldChunks.map((tail) => ({ cmd, args: [key, ...tail] })),
      );
      return replies.flat();
    }

    if (canonical === "XACK") {
      const [stream, group, ...ids] = args;
      const idChunks = chunks(ids, MAX_HTTP_ARGS - 2);
      const replies = await executeBatch(
        idChunks.map((tail) => ({ cmd, args: [stream, group, ...tail] })),
      );
      return replies.reduce((total, value) => total + Number(value ?? 0), 0);
    }

    throw new Error(`Redis HTTP bridge command ${cmd} exceeds the ${MAX_HTTP_ARGS}-argument limit`);
  };

  const normalizeKeys = (args: unknown[]): unknown[] =>
    args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;

  const healthCheck = async (): Promise<void> => {
    const healthUrl = url.includes("?") ? `${url}&health=true` : `${url}?health=true`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await withHttpSlot(controller.signal, () =>
        fetch(healthUrl, {
          method: "GET",
          headers: { apikey: key },
          signal: controller.signal,
        }),
      );
      const payload = await res.json() as {
        ok?: boolean;
        ping?: string;
        latency_ms?: number;
        keys?: number;
        reconnects?: number;
      };

      if (!res.ok || payload.ok !== true || payload.ping !== "PONG") {
        isConnected = false;
        if (res.status >= 500 || res.status === 503) openHttpCircuit();
        logger.error(
          { status: res.status, redisStatus: payload.ping ?? "unknown" },
          "Redis HTTP bridge health check failed",
        );
        return;
      }

      isConnected = true;
      httpCircuitOpenUntil = 0;
      logger.info(
        { latencyMs: payload.latency_ms, keys: payload.keys, reconnects: payload.reconnects },
        "Redis HTTP bridge health check passed",
      );
    } catch (err) {
      openHttpCircuit();
      logger.error(
        { err: { message: (err as any)?.message } },
        "Redis HTTP bridge health check failed",
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const pipeline = () => {
    const ops: Array<{ cmd: string; args: unknown[] }> = [];
    const push = (cmd: string, args: unknown[]) => {
      ops.push({ cmd, args: normalizeKeys(args) });
      return outer;
    };
    const outer = {
      sadd: (k: string, v: string) => push("sadd", [k, v]),
      incr: (k: string) => push("incr", [k]),
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
    healthCheck,
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
  // A serverless instance is often created per request. Pinging Redis on
  // every cold start multiplies bridge traffic precisely when a media grid
  // creates a burst of requests. On Vercel the first real cache operation is
  // the probe; health checks remain enabled for long-lived Render processes.
  const isVercelRuntime =
    process.env.VERCEL_CACHE_LOCAL_ONLY === "1" ||
    process.env.VERCEL === "1" ||
    Boolean(process.env.VERCEL_URL) ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";
  if (!isVercelRuntime) {
    void client.healthCheck().catch((err: unknown) => {
      logger.error({ err: { message: (err as any)?.message } }, "Redis HTTP bridge health check failed");
    });
  }
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
      const isReconnect = hasWasConnected;
      isConnected = true;
      hasWasConnected = true;
      logger.info("Redis ready");
      if (isReconnect) {
        logger.info("Redis reconnected — flushing stale local memory cache");
        for (const listener of reconnectListeners) {
          try {
            listener();
          } catch (err) {
            logger.error({ err }, "Redis reconnect listener error");
          }
        }
      }
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
} else if (vercelLocalCacheMode) {
  logger.info("Redis bridge disabled by VERCEL_CACHE_LOCAL_ONLY; using local caches and database fallbacks");
} else {
  logger.warn("REDIS_URL not set, caching disabled");
}

// Public-response/media caches and the per-request rate limiter must not
// use the HTTPS bridge on Vercel: they are served by CDN/local caches instead.
// Feature state (view counters, activity streams, hot rankings, suggestions)
// can still use the shared self-hosted Redis bridge.
export function getRedis(): typeof client {
  return vercelLocalCacheMode ? null : client;
}

export function getFeatureRedis(): typeof client {
  return client;
}

export function isRedisConnected(): boolean {
  // The HTTP bridge has no persistent socket whose "ready" event can recover
  // after a transient timeout. Once the cooldown expires, let the next feature
  // operation try again; otherwise the first failed request permanently
  // disables Redis for the lifetime of that serverless instance.
  if (httpMode) return Date.now() >= httpCircuitOpenUntil;
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


let hasWasConnected = false;
const reconnectListeners = new Set<() => void>();

export function onRedisReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

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
  const noop: PubSubSubscription = {
    active: false,
    unsubscribe() { /* nothing to do */ },
  };

  // The HTTPS bridge is request/response only; it has no socket to duplicate
  // for Pub/Sub. Check this before ensurePubSubClient(), which needs ioredis'
  // duplicate() method and is unavailable on the HTTP compatibility client.
  if (httpMode) return noop;

  const sub = ensurePubSubClient();
  if (!sub) return noop;

  let disposed = false;
  let subscribed = false;

  const onMessage = (receivedChannel: string, message: string) => {
    if (receivedChannel !== channel || disposed) return;
    try {
      handler(message);
    } catch (err) {
      logger.error({ err, channel }, "Redis pub/sub handler error");
    }
  };

  // ioredis is configured with enableOfflineQueue=false. SUBSCRIBE must not
  // be sent until the duplicate socket is ready, or a cold start throws
  // "Stream isn't writeable" and the invalidation listener silently stays off.
  const subscribeWhenReady = () => {
    if (disposed || sub.status !== "ready" || subscribed) return;
    try {
      sub.subscribe(channel, (err: unknown) => {
        if (disposed) return;
        if (err) {
          subscribed = false;
          logger.error({ err, channel }, "Redis subscribe failed");
          return;
        }
        subscribed = true;
        logger.info({ channel }, "Redis pub/sub subscribed");
      });
    } catch (err) {
      subscribed = false;
      logger.error({ err, channel }, "Redis subscribe setup error");
    }
  };

  const onClose = () => {
    subscribed = false;
  };

  sub.on("message", onMessage);
  sub.on("ready", subscribeWhenReady);
  sub.on("close", onClose);
  subscribeWhenReady();

  return {
    // True means the listener has been registered and will subscribe when
    // Redis becomes ready; it does not imply that the socket is connected yet.
    get active() {
      return !disposed;
    },
    unsubscribe() {
      if (disposed) return;
      disposed = true;
      sub.removeListener("ready", subscribeWhenReady);
      sub.removeListener("close", onClose);
      sub.removeListener("message", onMessage);
      try {
        if (subscribed && sub.status === "ready") {
          sub.unsubscribe(channel).catch(() => {});
        }
      } catch { /* already closed */ }
      subscribed = false;
    },
  };
}
