#!/bin/bash
set -e

# Install dependencies
pnpm install --frozen-lockfile

# Run database migrations
pnpm --filter db push

# Flush Redis cache on every deploy for a guaranteed clean slate.
# This ensures no stale data from previous deploys is served.
# Uses REDIS_URL if set; skips gracefully if Redis is not configured.
if [ -n "$REDIS_URL" ]; then
  echo "Flushing Redis cache..."
  redis-cli -u "$REDIS_URL" FLUSHALL 2>/dev/null || echo "Warning: Redis flush failed (non-fatal)"
fi
