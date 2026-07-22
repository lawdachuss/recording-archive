import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { db, sql } from "@workspace/db";

const router = Router();

// ─── Public: Resolve username to email (used by login page) ───────────────────

router.get("/user/resolve-username", async (req, res) => {
  try {
    const username = (req.query.username as string)?.trim().toLowerCase();
    if (!username) {
      res.status(400).json({ error: "username query param required" });
      return;
    }

    // 1. Check user_profiles table first — this is the primary username store.
    //    Usernames are stored here when a user signs up or updates their profile.
    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("email")
        .ilike("username", username)
        .limit(1)
        .single();

      if (profile?.email) {
        res.json({ email: profile.email });
        return;
      }
    } catch {
      // Fall through to fallback methods
    }

    // 2. Fallback: try the resolve_username RPC (checks auth.users raw_user_meta_data)
    try {
      const { data: email, error: rpcError } = await supabase.rpc("resolve_username", {
        p_username: username,
      });

      if (!rpcError && email) {
        res.json({ email });
        return;
      }
    } catch {
      // Fall through to not found
    }

    // 3. Not found via any method
    res.status(404).json({ error: "Username not found" });
  } catch (err) {
    req.log?.error?.({ err }, "GET /user/resolve-username unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.use("/user", requireAuth);

// ─── Profile ─────────────────────────────────────────────────────────────────

router.get("/user/profile", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("user_profiles")
      .select("user_id, display_name, avatar_url, bio, created_at, updated_at, username, email")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      req.log.error({ err: error }, "Supabase error fetching user profile");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!data) {
      const meta = req.user!.user_metadata as Record<string, unknown> | undefined;
      const name = (meta?.username as string) ?? req.user!.email?.split("@")[0] ?? "User";
      const { data: created, error: insertError } = await req.supabase!
        .from("user_profiles")
        .insert({ user_id: userId, display_name: name, email: req.user!.email, username: meta?.username as string | undefined })
        .select("user_id, display_name, avatar_url, bio, created_at, updated_at, username, email")
        .single();

      if (insertError) {
        req.log.error({ err: insertError }, "Supabase error creating user profile");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      res.json(created ?? { user_id: userId, display_name: name });
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "GET /user/profile unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/user/profile", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { display_name, avatar_url, bio, username } = req.body as {
      display_name?: string;
      avatar_url?: string;
      bio?: string;
      username?: string;
    };

    const updates: { updated_at: string; display_name?: string; avatar_url?: string; bio?: string; username?: string } = { updated_at: new Date().toISOString() };
    if (display_name !== undefined) updates.display_name = display_name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (bio !== undefined) updates.bio = bio;
    if (username !== undefined) updates.username = username.trim().toLowerCase();

    const { data, error } = await req.supabase!
      .from("user_profiles")
      .upsert({ user_id: userId, ...updates })
      .select("user_id, display_name, avatar_url, bio, created_at, updated_at, username, email")
      .single();

    if (error) {
      req.log.error({ err: error }, "Supabase error updating user profile");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "PUT /user/profile unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Role ─────────────────────────────────────────────────────────────────────

router.get("/user/role", async (req, res) => {
  try {
    const userId = req.user!.id;
    const result = await db.execute(sql`
      SELECT role FROM user_roles WHERE user_id = ${userId}
    `);

    const role = result.rows[0]?.role;
    res.json({
      role: role === "admin" || role === "moderator" || role === "user" ? role : "user",
    });
  } catch (err) {
    req.log.error({ err }, "GET /user/role unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Saved Videos ─────────────────────────────────────────────────────────────

router.get("/user/saved", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("saved_videos")
      .select("recording_id, metadata, saved_at")
      .eq("user_id", userId)
      .order("saved_at", { ascending: false });

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching saved videos");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(data ?? []);
  } catch (err) {
    req.log.error({ err }, "GET /user/saved unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/user/saved", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
    if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }

    const { error } = await req.supabase!.from("saved_videos").upsert(
      { user_id: userId, recording_id, metadata: metadata ?? null },
      { onConflict: "user_id, recording_id" },
    );

    if (error) {
      req.log.error({ err: error }, "Supabase error saving video");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /user/saved unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/saved/:recordingId", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("saved_videos")
      .delete()
      .eq("user_id", userId)
      .eq("recording_id", req.params.recordingId);

    if (error) {
      req.log.error({ err: error }, "Supabase error deleting saved video");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/saved/:recordingId unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Watch History ────────────────────────────────────────────────────────────

router.get("/user/history", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("watch_history")
      .select("recording_id, metadata, watched_at")
      .eq("user_id", userId)
      .order("watched_at", { ascending: false })
      .limit(200);

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching watch history");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(data ?? []);
  } catch (err) {
    req.log.error({ err }, "GET /user/history unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/user/history", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
    if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }

    const { error } = await req.supabase!.from("watch_history").upsert(
      { user_id: userId, recording_id, metadata: metadata ?? null, watched_at: new Date().toISOString() },
      { onConflict: "user_id, recording_id" },
    );

    if (error) {
      req.log.error({ err: error }, "Supabase error adding watch history");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /user/history unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/history", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("watch_history")
      .delete()
      .eq("user_id", userId);

    if (error) {
      req.log.error({ err: error }, "Supabase error clearing watch history");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/history unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Watch Later ──────────────────────────────────────────────────────────────

router.get("/user/watch-later", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("watch_later_items")
      .select("recording_id, metadata, added_at")
      .eq("user_id", userId)
      .order("added_at", { ascending: true });

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching watch later");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(data ?? []);
  } catch (err) {
    req.log.error({ err }, "GET /user/watch-later unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/user/watch-later", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
    if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }

    const { error } = await req.supabase!.from("watch_later_items").upsert(
      { user_id: userId, recording_id, metadata: metadata ?? null, added_at: new Date().toISOString() },
      { onConflict: "user_id, recording_id", ignoreDuplicates: true },
    );

    if (error) {
      req.log.error({ err: error }, "Supabase error adding watch later");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /user/watch-later unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/watch-later/:recordingId", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("watch_later_items")
      .delete()
      .eq("user_id", userId)
      .eq("recording_id", req.params.recordingId);

    if (error) {
      req.log.error({ err: error }, "Supabase error deleting watch later item");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/watch-later/:recordingId unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/watch-later", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("watch_later_items")
      .delete()
      .eq("user_id", userId);

    if (error) {
      req.log.error({ err: error }, "Supabase error clearing watch later");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/watch-later unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Collections ──────────────────────────────────────────────────────────────

router.get("/user/collections", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data: cols, error } = await req.supabase!
      .from("user_collections")
      .select("id, name, description, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching collections");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Enrich with item count and first item metadata
    const enriched = await Promise.all(
      (cols ?? []).map(async (col) => {
        const { data: items, count, error: itemsError } = await req.supabase!
          .from("user_collection_items")
          .select("metadata", { count: "exact", head: false })
          .eq("collection_id", col.id)
          .order("added_at", { ascending: true });

        interface CollectionItem {
          metadata: string | null;
        }
        const collectionItems = (items ?? []) as CollectionItem[];
        return {
          ...col,
          item_count: count ?? items?.length ?? 0,
          first_item_metadata: collectionItems[0]?.metadata ?? null,
        };
      }),
    );

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "GET /user/collections unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/user/collections", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { name, description } = req.body as { name: string; description?: string };
    if (!name?.trim()) { res.status(400).json({ error: "name required" }); return; }

    const id = crypto.randomUUID();
    const { data, error } = await req.supabase!
      .from("user_collections")
      .insert({ id, user_id: userId, name: name.trim(), description: description ?? null })
      .select("id, name, description, created_at, updated_at")
      .single();

    if (error) {
      req.log.error({ err: error }, "Supabase error creating collection");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.status(201).json(data);
  } catch (err) {
    req.log.error({ err }, "POST /user/collections unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/user/collections/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { name, description } = req.body as { name?: string; description?: string };

    const updates: { updated_at: string; name?: string; description?: string } = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    const { data, error } = await req.supabase!
      .from("user_collections")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .select("id, name, description, created_at, updated_at")
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      req.log.error({ err: error }, "Supabase error updating collection");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "PUT /user/collections/:id unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/collections/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    // Delete collection items first (cascade should handle this, but be explicit)
    await req.supabase!.from("user_collection_items").delete().eq("collection_id", req.params.id);

    const { error } = await req.supabase!
      .from("user_collections")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", userId);

    if (error) {
      req.log.error({ err: error }, "Supabase error deleting collection");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/collections/:id unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/user/collections/:id/items", async (req, res) => {
  try {
    const userId = req.user!.id;
    // Verify ownership
    const { data: col, error: colError } = await req.supabase!
      .from("user_collections")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .single();

    if (colError || !col) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const { data: items, error } = await req.supabase!
      .from("user_collection_items")
      .select("recording_id, metadata, added_at")
      .eq("collection_id", req.params.id)
      .order("added_at", { ascending: false });

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching collection items");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(items ?? []);
  } catch (err) {
    req.log.error({ err }, "GET /user/collections/:id/items unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/user/collections/:id/items", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { recording_id, metadata } = req.body as { recording_id: string; metadata?: string };
    if (!recording_id) { res.status(400).json({ error: "recording_id required" }); return; }

    // Verify ownership
    const { data: col, error: colError } = await req.supabase!
      .from("user_collections")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .single();

    if (colError || !col) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const { error } = await req.supabase!.from("user_collection_items").upsert(
      { collection_id: req.params.id, recording_id, metadata: metadata ?? null },
      { onConflict: "collection_id, recording_id", ignoreDuplicates: true },
    );

    if (error) {
      req.log.error({ err: error }, "Supabase error adding collection item");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /user/collections/:id/items unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/collections/:id/items/:recordingId", async (req, res) => {
  try {
    const userId = req.user!.id;
    // Verify collection ownership
    const { data: col, error: colError } = await req.supabase!
      .from("user_collections")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", userId)
      .single();

    if (colError || !col) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { error } = await req.supabase!
      .from("user_collection_items")
      .delete()
      .eq("collection_id", req.params.id)
      .eq("recording_id", req.params.recordingId);

    if (error) {
      req.log.error({ err: error }, "Supabase error deleting collection item");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/collections/:id/items/:recordingId unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Performer Follows ────────────────────────────────────────────────────────

router.get("/user/follows", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("performer_follows")
      .select("performer_username, followed_at")
      .eq("user_id", userId)
      .order("followed_at", { ascending: false });

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching follows");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(data ?? []);
  } catch (err) {
    req.log.error({ err }, "GET /user/follows unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/user/follows", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { performer_username } = req.body as { performer_username: string };
    if (!performer_username) { res.status(400).json({ error: "performer_username required" }); return; }

    const { error } = await req.supabase!.from("performer_follows").upsert(
      { user_id: userId, performer_username, followed_at: new Date().toISOString() },
      { onConflict: "user_id, performer_username", ignoreDuplicates: true },
    );

    if (error) {
      req.log.error({ err: error }, "Supabase error following performer");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /user/follows unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/follows/:username", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("performer_follows")
      .delete()
      .eq("user_id", userId)
      .eq("performer_username", req.params.username);

    if (error) {
      req.log.error({ err: error }, "Supabase error unfollowing performer");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/follows/:username unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Notifications ────────────────────────────────────────────────────────────

router.get("/user/notifications", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("user_notifications")
      .select("id, type, message, related_id, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching notifications");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json(data ?? []);
  } catch (err) {
    req.log.error({ err }, "GET /user/notifications unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/user/notifications/read-all", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("user_notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) {
      req.log.error({ err: error }, "Supabase error marking notifications read");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PUT /user/notifications/read-all unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/user/notifications/read-batch", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { ids } = req.body as { ids?: number[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids array required" });
      return;
    }

    const { error } = await req.supabase!
      .from("user_notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .in("id", ids);

    if (error) {
      req.log.error({ err: error }, "Supabase error marking notifications read (batch)");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PUT /user/notifications/read-batch unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/user/notifications/:id/read", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("user_notifications")
      .update({ is_read: true })
      .eq("id", req.params.id)
      .eq("user_id", userId);

    if (error) {
      req.log.error({ err: error }, "Supabase error marking notification read");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PUT /user/notifications/:id/read unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Sound & Vibration Preferences (global, stored on user_profiles) ────

router.get("/user/sound-preferences", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("user_profiles")
      .select("sound_enabled, vibration_enabled")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      req.log.error({ err: error }, "Supabase error fetching sound preferences");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.json({
      sound_enabled: data?.sound_enabled ?? true,
      vibration_enabled: data?.vibration_enabled ?? true,
    });
  } catch (err) {
    req.log.error({ err }, "GET /user/sound-preferences unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/user/sound-preferences", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { sound_enabled, vibration_enabled } = req.body as {
      sound_enabled?: boolean;
      vibration_enabled?: boolean;
    };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (sound_enabled !== undefined) updates.sound_enabled = sound_enabled;
    if (vibration_enabled !== undefined) updates.vibration_enabled = vibration_enabled;

    const { error } = await req.supabase!
      .from("user_profiles")
      .upsert({ user_id: userId, ...updates });

    if (error) {
      req.log.error({ err: error }, "Supabase error updating sound preferences");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PUT /user/sound-preferences unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Notification Preferences ────────────────────────────────────────────

const NOTIFICATION_TYPES = ["request_submitted", "request_status", "recording_available"];

router.get("/user/notification-preferences", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { data, error } = await req.supabase!
      .from("user_notification_preferences")
      .select("notification_type, enabled, email_enabled")
      .eq("user_id", userId);

    if (error) {
      req.log.error({ err: error }, "Supabase error fetching notification preferences");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Merge with defaults: any type not in DB is enabled (in-app) and disabled (email) by default
    const enabledMap = new Map<string, boolean>();
    const emailMap = new Map<string, boolean>();
    for (const t of NOTIFICATION_TYPES) {
      enabledMap.set(t, true);
      emailMap.set(t, false);
    }
    for (const row of data ?? []) {
      enabledMap.set(row.notification_type, row.enabled);
      emailMap.set(row.notification_type, row.email_enabled ?? false);
    }

    res.json(
      NOTIFICATION_TYPES.map((type) => ({
        type,
        enabled: enabledMap.get(type) ?? true,
        email_enabled: emailMap.get(type) ?? false,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "GET /user/notification-preferences unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/user/notification-preferences", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { preferences } = req.body as {
      preferences: { type: string; enabled: boolean; email_enabled?: boolean }[];
    };

    if (!Array.isArray(preferences)) {
      res.status(400).json({ error: "preferences array required" });
      return;
    }

    // Validate types
    for (const p of preferences) {
      if (!NOTIFICATION_TYPES.includes(p.type)) {
        res.status(400).json({ error: `Invalid notification type: ${p.type}` });
        return;
      }
    }

    // Upsert each preference
    for (const p of preferences) {
      const { error } = await req.supabase!.from("user_notification_preferences").upsert(
        {
          user_id: userId,
          notification_type: p.type,
          enabled: p.enabled,
          email_enabled: p.email_enabled ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id, notification_type" }
      );

      if (error) {
        req.log.error({ err: error }, "Supabase error upserting notification preference");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PUT /user/notification-preferences unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/user/notifications/:id", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { error } = await req.supabase!
      .from("user_notifications")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", userId);

    if (error) {
      req.log.error({ err: error }, "Supabase error deleting notification");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /user/notifications/:id unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
