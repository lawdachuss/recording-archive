import { Router, type IRouter, type Request, type Response } from "express";
import { db, sql } from "@workspace/db";
import { requireRole } from "../middleware/requireRole.js";
import { getCacheStats, invalidateTags, invalidatePattern, purgeAllCache } from "../middleware/cache.js";
import { getRedis, isRedisConnected, getRedisStatus } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const admin = requireRole("admin");

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

router.get("/admin/stats", ...admin, async (_req: Request, res: Response) => {
  const count = async (label: string, query: ReturnType<typeof sql>) => {
    try {
      const result = await db.execute(query);
      const row = result.rows[0] as { count?: unknown } | undefined;
      return Number(row?.count ?? 0);
    } catch (err) {
      _req.log?.error?.({ err, stat: label }, "GET /admin/stats count failed");
      return 0;
    }
  };

  const requests = async () => {
    const fallback = { total: 0, pending: 0, approved: 0, rejected: 0, done: 0 };
    try {
      const result = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int, 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)::int, 0) AS approved,
          COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)::int, 0) AS rejected,
          COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int, 0) AS done
        FROM requests
      `);
      return (result.rows[0] ?? fallback) as typeof fallback;
    } catch (err) {
      _req.log?.error?.({ err, stat: "requests" }, "GET /admin/stats requests count failed");
      return fallback;
    }
  };

  const [users, requestCounts, recordings, performers] = await Promise.all([
    count("users", sql`SELECT COUNT(*)::int AS count FROM user_profiles`),
    requests(),
    count("recordings", sql`SELECT COUNT(*)::int AS count FROM recordings`),
    count("performers", sql`
        SELECT COUNT(DISTINCT username)::int AS count
        FROM recordings_with_links
        WHERE links IS NOT NULL AND links::text <> '{}'
      `),
  ]);

  res.json({ users, recordings, performers, requests: requestCounts });
});

// ─── Requests Management ──────────────────────────────────────────────────────

router.get("/admin/requests", ...admin, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const validStatuses = ["pending", "approved", "rejected", "done"];

    let query = sql`
      SELECT r.id, r.user_id, r.platform, r.performer_username, r.stream_link,
             r.notes, r.priority, r.status, r.created_at,
             up.display_name, up.username, up.email
      FROM requests r
      LEFT JOIN user_profiles up ON r.user_id = up.user_id
    `;

    if (status && validStatuses.includes(status)) {
      query = sql`
        ${query} WHERE r.status = ${status}
      `;
    }

    query = sql`${query} ORDER BY r.created_at DESC LIMIT 500`;

    const result = await db.execute(query);
    res.json(result.rows);
  } catch (err) {
    req.log?.error?.({ err }, "GET /admin/requests error");
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.patch("/admin/requests/:id/status", ...admin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const { status } = req.body as { status?: string };
  const valid = ["pending", "approved", "rejected", "done"];

  if (!status || !valid.includes(status)) {
    res.status(400).json({ error: "status must be one of: pending, approved, rejected, done" });
    return;
  }

  try {
    const result = await db.execute(sql`
      UPDATE requests SET status = ${status} WHERE id = ${id}
      RETURNING id, user_id, platform, performer_username, stream_link, notes, priority, status, created_at
    `);

    if (!result.rows.length) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    logger.info({ requestId: id, newStatus: status, adminId: req.user!.id }, "Request status updated by admin");
    res.json(result.rows[0]);
  } catch (err) {
    req.log?.error?.({ err }, "PATCH /admin/requests/:id/status error");
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.delete("/admin/requests/:id", ...admin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);

  try {
    const result = await db.execute(sql`
      DELETE FROM requests WHERE id = ${id}
      RETURNING id
    `);

    if (!result.rows.length) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    logger.info({ requestId: id, adminId: req.user!.id }, "Request deleted by admin");
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "DELETE /admin/requests/:id error");
    res.status(500).json({ error: "Failed to delete request" });
  }
});

// ─── Users Management ─────────────────────────────────────────────────────────

router.get("/admin/users", ...admin, async (req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT
        up.user_id,
        up.display_name,
        up.username,
        up.email,
        up.avatar_url,
        up.created_at,
        COALESCE(ur.role, 'user') AS role
      FROM user_profiles up
      LEFT JOIN user_roles ur ON up.user_id = ur.user_id
      ORDER BY up.created_at DESC
      LIMIT 500
    `);

    res.json(result.rows);
  } catch (err) {
    req.log?.error?.({ err }, "GET /admin/users error");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.patch("/admin/users/:id/role", ...admin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role } = req.body as { role?: string };
  const validRoles = ["user", "moderator", "admin"];

  if (!role || !validRoles.includes(role)) {
    res.status(400).json({ error: "role must be one of: user, moderator, admin" });
    return;
  }

  try {
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role, created_at)
      VALUES (${id}, ${role}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET role = ${role}
    `);

    logger.info({ targetUserId: id, newRole: role, adminId: req.user!.id }, "User role updated by admin");
    res.json({ ok: true, role });
  } catch (err) {
    req.log?.error?.({ err }, "PATCH /admin/users/:id/role error");
    res.status(500).json({ error: "Failed to update role" });
  }
});

router.delete("/admin/users/:id", ...admin, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    if (id === req.user!.id) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }

    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM user_profiles WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM saved_videos WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM watch_history WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM watch_later_items WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM user_collections WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM performer_follows WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM user_notifications WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM requests WHERE user_id = ${id}`);

    logger.info({ targetUserId: id, adminId: req.user!.id }, "User deleted by admin");
    res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "DELETE /admin/users/:id error");
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// ─── Cache Management ─────────────────────────────────────────────────────────

router.get("/admin/cache/status", ...admin, async (_req: Request, res: Response) => {
  const redis = getRedis();
  const status = getRedisStatus();
  const connected = isRedisConnected();

  let info: Record<string, unknown> = { connected, status, memory: getCacheStats() };

  if (redis && connected) {
    try {
      const dbsize = await redis.dbsize();
      info = { ...info, keys: dbsize };
    } catch {
      info = { ...info, keys: "error" };
    }
  }

  res.json(info);
});

router.post("/admin/cache/invalidate", ...admin, async (req: Request, res: Response) => {
  const { tags, pattern } = req.body as {
    tags?: string[];
    pattern?: string;
  };

  if (!tags && !pattern) {
    res.status(400).json({ error: "Provide 'tags' (array) or 'pattern' (string)" });
    return;
  }

  try {
    if (tags && tags.length > 0) {
      await invalidateTags(tags);
      logger.info({ tags, adminId: req.user!.id }, "Cache invalidated by admin");
      res.json({ invalidated: "tags", tags });
      return;
    }

    if (pattern) {
      const count = await invalidatePattern(pattern);
      logger.info({ pattern, count, adminId: req.user!.id }, "Cache invalidated by admin");
      res.json({ invalidated: "pattern", pattern, keysDeleted: count });
      return;
    }
  } catch (err) {
    logger.error({ err }, "Cache invalidation failed");
    res.status(500).json({ error: "Cache invalidation failed" });
  }
});

router.post("/admin/cache/purge", ...admin, async (_req: Request, res: Response) => {
  try {
    const result = await purgeAllCache();
    logger.info({ adminId: _req.user!.id }, "Cache purged by admin");
    res.json({
      purged: true,
      deletedKeys: result.deletedKeys,
      invalidatedTags: result.invalidatedTags,
    });
  } catch (err) {
    logger.error({ err }, "Cache purge failed");
    res.status(500).json({ error: "Cache purge failed" });
  }
});

router.delete("/admin/cache/flush", ...admin, async (_req: Request, res: Response) => {
  const redis = getRedis();

  try {
    const memoryResult = await purgeAllCache();

    if (!redis || !isRedisConnected()) {
      logger.info({ keysDeleted: memoryResult.deletedKeys, adminId: _req.user!.id }, "Cache flushed by admin");
      res.json({ flushed: true, keysDeleted: memoryResult.deletedKeys });
      return;
    }

    let cursor = "0";
    let deleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "api:*", "COUNT", 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");

    cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "tag:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");

    const keysDeleted = deleted + memoryResult.deletedKeys;
    logger.info({ keysDeleted, adminId: _req.user!.id }, "Cache flushed by admin");
    res.json({ flushed: true, keysDeleted });
  } catch (err) {
    logger.error({ err }, "Cache flush failed");
    res.status(500).json({ error: "Cache flush failed" });
  }
});

export default router;
