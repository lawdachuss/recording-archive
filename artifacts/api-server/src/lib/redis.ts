// redis.ts — Redis client via ioredis (optional dependency)
// Gracefully degrades to null exports when ioredis is not installed.

import { logger } from "./logger.js";

let cachedClient: Redis | null = null;

function tryImportRedis(): typeof import("ioredis") | null {
  try {
    return require("ioredis") as typeof import("ioredis");
  } catch {
    return null;
  }
}

interface RedisModule {
  Redis: new (url: string, opts?: Record<string, unknown>) => {
    on(event: string, cb: (...args: unknown[]) => void): void;
    connect(): Promise<void>;
    status: string;
  };
}

let _Redis: RedisModule["Redis"] | null = null;

const redisUrl = process.env.REDIS_URL;
let client: InstanceType<RedisModule["Redis"]> | null = null;
let isConnected = false;

if (redisUrl) {
  const mod = tryImportRedis();
  if (!mod) {
    logger.warn("ioredis not available, Redis caching disabled");
  } else {
    _Redis = mod.Redis;
    client = new _Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(100 * Math.pow(3, times - 1), 5000);
        if (times > 5) {
          logger.error("Redis max retries reached, giving up");
          return null;
        }
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: true,
      commandTimeout: 5000,
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
