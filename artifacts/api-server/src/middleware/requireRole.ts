import type { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "./auth.js";

const ROLE_HIERARCHY = { user: 0, moderator: 1, admin: 2 } as const;

async function getUserRole(userId: string): Promise<string> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? "user";
}

export function requireRole(minimumRole: "moderator" | "admin") {
  return [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userRole = (await getUserRole(req.user!.id)) as keyof typeof ROLE_HIERARCHY;
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
