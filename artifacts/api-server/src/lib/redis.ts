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
let client: any = null;
let isConnected = false;

if (redisUrl) {
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
  return client?.status ?? "none";
}
