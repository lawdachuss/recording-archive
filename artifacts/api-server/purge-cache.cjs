#!/usr/bin/env node
/**
 * purge-cache.cjs
 *
 * Call this after any external data sync (e.g. after add-links.cjs) to
 * invalidate all cached API responses. This ensures the frontend sees
 * fresh data without waiting for TTL expiry.
 *
 * Usage:
 *   node purge-cache.cjs              # Uses REDIS_URL from .env
 *   REDIS_URL=redis://... node purge-cache.cjs   # Override URL
 *
 * On success it prints a JSON line like:
 *   {"purged":true,"deletedKeys":47,"invalidatedTags":4}
 *
 * Exit code 0 = success, 1 = failure.
 */

require("dotenv/config");

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('{"error":"REDIS_URL not set"}');
  process.exit(1);
}

const ALL_TAGS = ["performers", "recordings", "stats", "tags"];

async function main() {
  const Redis = require("ioredis");
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    commandTimeout: 5000,
    lazyConnect: true,
  });

  await redis.connect();
  console.error("Connected to Redis, purging cache tags...");

  let totalDeleted = 0;

  // 1. Invalidate by tag sets
  for (const tag of ALL_TAGS) {
    const members = await redis.smembers(`tag:${tag}`);
    const keysToDel = [...members, `tag:${tag}`];
    if (keysToDel.length > 1) {
      const delCount = await redis.del(keysToDel);
      totalDeleted += delCount;
    } else {
      await redis.del(`tag:${tag}`);
    }
  }

  // 2. Scan and delete any remaining api:* keys
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "api:*", "COUNT", 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      const delCount = await redis.del(keys);
      totalDeleted += delCount;
    }
  } while (cursor !== "0");

  await redis.quit();

  const result = { purged: true, deletedKeys: totalDeleted, invalidatedTags: ALL_TAGS.length };
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
