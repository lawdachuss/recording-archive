import { Router, type IRouter, type Request, type Response } from "express";
import { supabase, fetchAll } from "../lib/supabase.js";
import { requireRole } from "../middleware/requireRole.js";
import { getCacheStats, getCacheMetrics, invalidateTags, invalidatePattern, purgeAllCache } from "../middleware/cache.js";
import { getRedis, isRedisConnected, getRedisStatus } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const admin = requireRole("admin");

const REQUEST_COLS =
  "id,user_id,platform,performer_username,stream_link,notes,priority,status,created_at";

/** Fetch user_profiles rows for a set of user ids (chunked to avoid IN-clause limits). */
async function fetchProfiles(userIds: string[]) {
  const profiles = new Map<string, { display_name: string | null; username: string | null; email: string | null }>();
  const ids = [...new Set(userIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id,display_name,username,email")
      .in("user_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      profiles.set(row.user_id, {
        display_name: row.display_name ?? null,
        username: row.username ?? null,
        email: row.email ?? null,
      });
    }
  }
  return profiles;
}

/** Fetch roles for a set of user ids (chunked). */
async function fetchRoles(userIds: string[]) {
  const roles = new Map<string, string>();
  const ids = [...new Set(userIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id,role")
      .in("user_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) roles.set(row.user_id, row.role);
  }
  return roles;
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

router.get("/admin/stats", ...admin, async (_req: Request, res: Response) => {
  const safeCount = async (
    label: string,
    run: () => Promise<{ count: number | null; error: unknown }>,
  ) => {
    try {
      const { count, error } = await run();
      if (error) throw error;
      return count ?? 0;
    } catch (err) {
      _req.log?.error?.({ err, stat: label }, "GET /admin/stats count failed");
      return 0;
    }
  };

  const requests = async () => {
    const fallback = { total: 0, pending: 0, approved: 0, rejected: 0, done: 0 };
    try {
      const { data, error } = await fetchAll((start, end) =>
        supabase.from("requests").select("status").range(start, end),
      );
      if (error) throw error;
      const counts = { total: 0, pending: 0, approved: 0, rejected: 0, done: 0 };
      counts.total = (data ?? []).length;
      for (const r of data ?? []) {
        if (r.status === "pending") counts.pending++;
        else if (r.status === "approved") counts.approved++;
        else if (r.status === "rejected") counts.rejected++;
        else if (r.status === "done") counts.done++;
      }
      return counts;
    } catch (err) {
      _req.log?.error?.({ err, stat: "requests" }, "GET /admin/stats requests count failed");
      return fallback;
    }
  };

  const performers = async () => {
    try {
      const { data, error } = await fetchAll((start, end) =>
        supabase
          .from("recordings_with_links")
          .select("username")
          .not("links", "is", "null")
          .range(start, end),
      );
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.username).filter(Boolean)).size;
    } catch (err) {
      _req.log?.error?.({ err, stat: "performers" }, "GET /admin/stats performers count failed");
      return 0;
    }
  };

  const [users, requestCounts, recordings, performerCount] = await Promise.all([
    safeCount("users", async () => supabase.from("user_profiles").select("user_id", { count: "exact", head: true })),
    requests(),
    safeCount("recordings", async () => supabase.from("recordings").select("id", { count: "exact", head: true })),
    performers(),
  ]);

  res.json({ users, recordings, performers: performerCount, requests: requestCounts });
});

// ─── Requests Management ──────────────────────────────────────────────────────

router.get("/admin/requests", ...admin, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const validStatuses = ["pending", "approved", "rejected", "done"];

    let query = supabase
      .from("requests")
      .select(REQUEST_COLS)
      .order("created_at", { ascending: false })
      .limit(500);

    if (status && validStatuses.includes(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      req.log?.error?.({ err: error }, "GET /admin/requests supabase error");
      res.status(500).json({ error: "Failed to fetch requests" });
      return;
    }

    const rows = data ?? [];
    const profiles = await fetchProfiles(rows.map((r) => r.user_id));
    res.json(
      rows.map((r) => {
        const p = profiles.get(r.user_id);
        return {
          ...r,
          display_name: p?.display_name ?? null,
          username: p?.username ?? null,
          email: p?.email ?? null,
        };
      }),
    );
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
    const { data: updated, error } = await supabase
      .from("requests")
      .update({ status })
      .eq("id", id)
      .select(REQUEST_COLS)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        res.status(404).json({ error: "Request not found" });
        return;
      }
      throw error;
    }

    logger.info({ requestId: id, newStatus: status, adminId: req.user!.id }, "Request status updated by admin");

    // ── Notify the requester ───────────────────────────────────────────────
    const statusLabels: Record<string, string> = {
      approved: "approved ✓",
      rejected: "rejected ✗",
      done: "completed ✓",
      pending: "pending",
    };
    const performerName = updated.performer_username ?? "a performer";
    const newLabel = statusLabels[updated.status] ?? updated.status;
    const message = `Your request for @${performerName} on ${updated.platform} has been ${newLabel}.`;

    try {
      const { data: prefRow } = await supabase
        .from("user_notification_preferences")
        .select("enabled")
        .eq("user_id", updated.user_id)
        .eq("notification_type", "request_status")
        .maybeSingle();
      const enabled = prefRow ? prefRow.enabled : true; // default: enabled
      if (enabled) {
        await supabase.from("user_notifications").insert({
          user_id: updated.user_id,
          type: "request_status",
          message,
          related_id: String(updated.id),
          is_read: false,
        });
      }
    } catch (notifErr) {
      // Non-critical — don't fail the whole request if notification insert fails
      req.log?.error?.({ err: notifErr, requestId: id }, "Failed to create notification for request status change");
    }

    res.json(updated);
  } catch (err) {
    req.log?.error?.({ err }, "PATCH /admin/requests/:id/status error");
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.delete("/admin/requests/:id", ...admin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);

  try {
    const { data, error } = await supabase
      .from("requests")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) throw error;
    if (!data || data.length === 0) {
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
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id,display_name,username,email,avatar_url,created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      req.log?.error?.({ err: error }, "GET /admin/users supabase error");
      res.status(500).json({ error: "Failed to fetch users" });
      return;
    }

    const rows = data ?? [];
    const roles = await fetchRoles(rows.map((r) => r.user_id));
    res.json(
      rows.map((r) => ({
        ...r,
        role: roles.get(r.user_id) ?? "user",
      })),
    );
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
    const { error } = await supabase
      .from("user_roles")
      .upsert({ user_id: id, role }, { onConflict: "user_id" });

    if (error) {
      req.log?.error?.({ err: error }, "PATCH /admin/users/:id/role supabase error");
      res.status(500).json({ error: "Failed to update role" });
      return;
    }

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

    // Supabase REST has no transactions, so delete related rows in dependency
    // order. A failure mid-way leaves a partial delete rather than rolling back.
    await supabase.from("user_roles").delete().eq("user_id", id);
    await supabase.from("saved_videos").delete().eq("user_id", id);
    await supabase.from("watch_history").delete().eq("user_id", id);
    await supabase.from("watch_later_items").delete().eq("user_id", id);

    // Collections must have their items removed before the collections row itself.
    const { data: collections } = await supabase.from("user_collections").select("id").eq("user_id", id);
    const collectionIds = (collections ?? []).map((c) => c.id);
    for (let i = 0; i < collectionIds.length; i += 100) {
      const chunk = collectionIds.slice(i, i + 100);
      await supabase.from("user_collection_items").delete().in("collection_id", chunk);
    }
    await supabase.from("user_collections").delete().eq("user_id", id);

    await supabase.from("performer_follows").delete().eq("user_id", id);
    await supabase.from("user_notifications").delete().eq("user_id", id);
    await supabase.from("user_notification_preferences").delete().eq("user_id", id);
    await supabase.from("requests").delete().eq("user_id", id);
    await supabase.from("user_profiles").delete().eq("user_id", id);

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

  let info: Record<string, unknown> = { connected, status, memory: getCacheStats(), metrics: getCacheMetrics() };

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
