import type { Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase, createUserClient } from "../lib/supabase.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string; token?: string; user_metadata?: Record<string, unknown> };
      supabase?: SupabaseClient;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = authHeader.slice(7);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.user = { id: user.id, email: user.email, token, user_metadata: user.user_metadata };
    req.supabase = createUserClient(token);
    next();
  } catch (err) {
    req.log?.error?.({ err }, "Auth middleware error");
    res.status(503).json({ error: "Authentication service unavailable" });
  }
}
