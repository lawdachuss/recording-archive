import type { Request, Response, NextFunction } from "express";
import { db, sql } from "@workspace/db";
import { requireAuth } from "./auth.js";

const ROLE_HIERARCHY = { user: 0, moderator: 1, admin: 2 } as const;

export function requireRole(minimumRole: "moderator" | "admin") {
  return [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await db.execute(sql`
        SELECT role FROM user_roles WHERE user_id = ${req.user!.id}
      `);

      const userRole = (result.rows[0]?.role ?? "user") as keyof typeof ROLE_HIERARCHY;
      const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
      const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

      if (userLevel < requiredLevel) {
        res.status(403).json({ error: "Forbidden: insufficient privileges" });
        return;
      }

      next();
    } catch (err) {
      req.log?.error?.({ err }, "requireRole middleware error");
      res.status(503).json({ error: "Authorization service unavailable" });
    }
  }];
}
