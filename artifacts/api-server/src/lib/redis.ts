import Redis from "ioredis";
import { logger } from "./logger.js";

const redisUrl = process.env.REDIS_URL;
let client: Redis | null = null;
let isConnected = false;

if (redisUrl) {
  client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      // Exponential backoff: 100ms, 300ms, 900ms, then stop
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

  client.on("error", (err) => {
    isConnected = false;
    logger.error({ err: { message: err.message, code: (err as any).code } }, "Redis error");
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

  // Attempt initial connection (non-blocking)
  client.connect().catch((err) => {
    logger.error({ err: { message: err.message } }, "Redis initial connection failed");
  });
} else {
  logger.warn("REDIS_URL not set, caching disabled");
}

export function getRedis(): Redis | null {
  return client;
}

export function isRedisConnected(): boolean {
  return isConnected && client?.status === "ready";
}

export function getRedisStatus(): string {
  return client?.status ?? "none";
}
