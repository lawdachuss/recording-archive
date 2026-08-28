import { Router } from "express";
import {
  ListRecordingsQueryParams,
  GetRecordingParams,
  ListRelatedRecordingsQueryParams,
} from "@workspace/api-zod";
import { supabase } from "../lib/supabase.js";
import { db, sql } from "@workspace/db";
import { cache } from "../middleware/cache.js";

const router = Router();

const LIST_COLS = "id,channel_id,username,filename,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,embed_url,preview_url,instance_id,created_at,updated_at";
const RELATED_COLS = "id,username,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,preview_url";
const POOL_COLS = "id,username,tags,gender,timestamp,viewers,thumbnail_url,sprite_url,preview_url";

// ─── LIST RECORDINGS ────────────────────────────────────────────────────────

router.get("/recordings", cache({ ttlSeconds: 90, staleSeconds: 300, tags: ["recordings", "search"] }), async (req, res) => {
  try {
    const parsed = ListRecordingsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }

    const { page = 1, limit = 24, search, tags, gender, username, resolution, sort } = parsed.data;
    const normalizedPage = Math.max(1, page);
    const normalizedLimit = Math.min(Math.max(1, limit), 100);

    let query = supabase.from("recordings_with_links").select(LIST_COLS, { count: "exact" }).not("links", "is", "null");

    if (search?.trim()) {
      const s = search.trim();
      query = query.or(`username.ilike.%${s}%,room_title.ilike.%${s}%,filename.ilike.%${s}%`);
    }
    if (tags) {
      const tagList = tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      if (tagList.length > 0) query = query.overlaps("tags", tagList);
    }
    if (gender) query = query.eq("gender", gender);
    if (username) query = query.eq("username", username);
    if (resolution) query = query.eq("resolution", resolution);

    const ascending = sort === "oldest";
    const sortCol = sort === "largest" ? "filesize" : sort === "popular" ? "viewers" : "timestamp";
    query = query.order(sortCol, { ascending, nullsFirst: false });

    const offset = (normalizedPage - 1) * normalizedLimit;
    const { data, error, count } = await query.range(offset, offset + normalizedLimit - 1);

    if (error) {
      req.log.error({ err: error }, "Supabase error listing recordings");
      res.status(500).json({ error: "Failed to fetch recordings" });
      return;
    }

    res.json({
      data: data ?? [],
      total: count ?? 0,
      page: normalizedPage,
      limit: normalizedLimit,
      totalPages: Math.ceil((count ?? 0) / normalizedLimit),
    });
  } catch (err) {
    req.log.error({ err }, "GET /recordings unexpected error");
    res.status(500).json({ error: "Failed to fetch recordings" });
  }
});

// ─── RECOMMENDATIONS ────────────────────────────────────────────────────────

router.get("/recordings/recommendations", cache({ ttlSeconds: 60, staleSeconds: 120, tags: ["recordings"] }), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? "12"), 10) || 12), 100);
    const excludeRaw = typeof req.query.exclude === "string" ? req.query.exclude : "";
    const exclude = excludeRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 200);
    const MAX_POOL = 1000;
    const seenIds = new Set<string>(exclude);

    let userTagFreq: Record<string, number> = {};
    let userPerformerFreq: Record<string, number> = {};
    let followedPerformers = new Set<string>();
    let savedTags: Record<string, number> = {};
    let savedPerformers: Record<string, number> = {};
    let watchLaterIds = new Set<string>();
    let watchedGenders: Record<string, number> = {};
    let isAuthenticated = false;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
        if (!authError && user) {
          isAuthenticated = true;
          const uid = user.id;

          const { data: history } = await supabase
            .from("watch_history")
            .select("recording_id, metadata, progress_seconds, duration_seconds, watched_at")
            .eq("user_id", uid)
            .order("watched_at", { ascending: false })
            .limit(100);

          const historyRecordingIds: string[] = [];
          const completionWeights = new Map<string, number>();
          if (history && history.length > 0) {
            for (const h of history) {
              if (h.recording_id) {
                seenIds.add(h.recording_id);
                historyRecordingIds.push(h.recording_id);
                const progress = Number(h.progress_seconds) || 0;
                const duration = Number(h.duration_seconds) || 1;
                const ratio = duration > 0 ? Math.min(progress / duration, 1) : 0.5;
                const cw = ratio < 0.1 ? 0.1 : ratio < 0.5 ? 0.5 : ratio < 0.8 ? 1 : 2;
                const daysAgo = h.watched_at ? (Date.now() - new Date(h.watched_at).getTime()) / 86400000 : 30;
                completionWeights.set(h.recording_id, cw * Math.max(0.5, 1 - daysAgo / 30));
              }
            }
          }

          const { data: follows } = await supabase.from("performer_follows").select("performer_username").eq("user_id", uid);
          if (follows) for (const f of follows) { if (f.performer_username) followedPerformers.add(f.performer_username); }

          const { data: saved } = await supabase.from("saved_videos").select("recording_id").eq("user_id", uid);
          const savedRecordingIds: string[] = [];
          if (saved) for (const s of saved) { if (s.recording_id) { savedRecordingIds.push(s.recording_id); seenIds.add(s.recording_id); } }

          const { data: watchLater } = await supabase.from("watch_later_items").select("recording_id").eq("user_id", uid);
          const watchLaterRecordingIds: string[] = [];
          if (watchLater) for (const w of watchLater) { if (w.recording_id) { watchLaterRecordingIds.push(w.recording_id); watchLaterIds.add(w.recording_id); seenIds.add(w.recording_id); } }

          const allIds = [...new Set([...historyRecordingIds, ...savedRecordingIds, ...watchLaterRecordingIds])];
          if (allIds.length > 0) {
            const { data: metaRows } = await supabase.from("recordings_with_links").select("id, username, tags, gender").in("id", allIds);
            if (metaRows) {
              const idToMeta = new Map(metaRows.map((r: any) => [r.id, r]));
              for (const hid of historyRecordingIds) {
                const m = idToMeta.get(hid);
                if (!m) continue;
                const cw = completionWeights.get(hid) ?? 0.5;
                if (m.tags) for (const tag of m.tags) userTagFreq[tag] = (userTagFreq[tag] ?? 0) + cw;
                if (m.username) userPerformerFreq[m.username] = (userPerformerFreq[m.username] ?? 0) + cw;
                if (m.gender) watchedGenders[m.gender] = (watchedGenders[m.gender] ?? 0) + cw;
              }
              for (const sid of savedRecordingIds) {
                const m = idToMeta.get(sid);
                if (!m) continue;
                if (m.tags) for (const tag of m.tags) savedTags[tag] = (savedTags[tag] ?? 0) + 2;
                if (m.username) savedPerformers[m.username] = (savedPerformers[m.username] ?? 0) + 2;
              }
            }
          }
        }
      } catch { /* auth failed silently */ }
    }

    const logWeight = (n: number) => Math.log10(n + 1);
    const diversify = (items: any[], pageSize: number, maxPerPerformer = 2): any[] => {
      const result: any[] = [];
      const pc: Record<string, number> = {};
      const w = [...items];
      while (result.length < pageSize && w.length > 0) {
        let p = -1;
        for (let i = 0; i < w.length; i++) { if ((pc[w[i].username || "unknown"] ?? 0) < maxPerPerformer) { p = i; break; } }
        if (p === -1) p = 0;
        const item = w.splice(p, 1)[0];
        const k = item.username || "unknown";
        pc[k] = (pc[k] ?? 0) + 1;
        result.push(item);
      }
      return result;
    };

    const scored: any[] = [];
    const addScored = (rows: any[] | null, baseScore: number) => {
      for (const r of (rows ?? [])) {
        if (seenIds.has(r.id)) continue;
        let score = baseScore;
        if (isAuthenticated) {
          for (const tag of r.tags ?? []) {
            if (userTagFreq[tag]) score += logWeight(userTagFreq[tag]) * 15;
            if (savedTags[tag]) score += logWeight(savedTags[tag]) * 30;
          }
          if (r.username) {
            if (userPerformerFreq[r.username]) score += logWeight(userPerformerFreq[r.username]) * 25;
            if (savedPerformers[r.username]) score += logWeight(savedPerformers[r.username]) * 40;
            if (followedPerformers.has(r.username)) score += 50;
          }
          const pg = Object.entries(watchedGenders).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (pg && r.gender === pg) score += 5;
          if (watchLaterIds.has(r.id)) score += 20;
        }
        score += logWeight(r.viewers ?? 0) * 3;
        const ageDays = r.timestamp ? (Date.now() - new Date(r.timestamp).getTime()) / 86400000 : 999;
        score += Math.max(0, 30 - ageDays * 0.5) + (Math.random() - 0.5) * 8;
        scored.push({ ...r, _score: score });
        seenIds.add(r.id);
      }
    };

    if (isAuthenticated) {
      const POOL = Math.min(Math.max(page * limit * 4, limit * 10), MAX_POOL);
      const { data } = await supabase.from("recordings_with_links").select(POOL_COLS).not("links", "is", "null").order("timestamp", { ascending: false }).limit(POOL * 2);
      addScored(data, 0);
      scored.sort((a: any, b: any) => b._score - a._score);
    } else {
      const POOL = Math.min(Math.max(page * limit * 4, limit * 10), MAX_POOL);
      const [newest, popular] = await Promise.all([
        supabase.from("recordings_with_links").select(POOL_COLS).not("links", "is", "null").order("timestamp", { ascending: false }).limit(POOL),
        supabase.from("recordings_with_links").select(POOL_COLS).not("links", "is", "null").order("viewers", { ascending: false, nullsFirst: false }).limit(POOL),
      ]);
      addScored(newest.data, 80);
      addScored(popular.data, 20);
      scored.sort((a: any, b: any) => b._score - a._score);
    }

    const diversified = diversify(scored, scored.length, 2);
    const totalItems = diversified.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;
    const pageRows = diversified.slice(offset, offset + limit).map(({ _score, ...r }: any) => r);

    res.json({ data: pageRows, total: totalItems, page: safePage, limit, totalPages });
  } catch (err) {
    req.log.error({ err }, "GET /recordings/recommendations unexpected error");
    res.status(500).json({ error: "Failed to get recommendations" });
  }
});

// ─── RANDOM ─────────────────────────────────────────────────────────────────

router.get("/recordings/random", cache({ ttlSeconds: 30, staleSeconds: 60, tags: ["recordings"] }), async (req, res) => {
  try {
    // Parse exclude list — comma-separated recording IDs to skip
    const excludeRaw = typeof req.query.exclude === "string" ? req.query.exclude : "";
    const excludeIds = new Set(
      excludeRaw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100),
    );

    // Fetch a pool of candidate IDs (more than needed for randomization)
    const POOL_SIZE = Math.max(200, excludeIds.size + 50);
    const { data: pool, error } = await supabase
      .from("recordings_with_links")
      .select("id")
      .not("links", "is", "null")
      .order("random()")
      .limit(POOL_SIZE);

    if (error) {
      req.log.error({ err: error }, "Supabase error getting recordings for random");
      res.status(500).json({ error: "Failed to get random recording" });
      return;
    }

    // Filter out excluded IDs and pick one
    const candidates = (pool ?? []).filter((r) => !excludeIds.has(r.id));

    if (candidates.length === 0) {
      // Fallback: try without exclusion
      const { data: fallback } = await supabase
        .from("recordings_with_links")
        .select("id")
        .not("links", "is", "null")
        .order("random()")
        .limit(1);
      if (fallback && fallback.length > 0) {
        res.json({ id: fallback[0].id });
        return;
      }
      res.status(404).json({ error: "No recordings found" });
      return;
    }

    const randomId = candidates[Math.floor(Math.random() * candidates.length)].id;
    res.json({ id: randomId });
  } catch (err) {
    req.log.error({ err }, "GET /recordings/random unexpected error");
    res.status(500).json({ error: "Failed to get random recording" });
  }
});

// ─── RELATED ────────────────────────────────────────────────────────────────

router.get("/recordings/related", cache({ ttlSeconds: 120, staleSeconds: 300, tags: ["recordings"] }), async (req, res) => {
  try {
    const parsed = ListRelatedRecordingsQueryParams.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "Invalid query params" }); return; }
    const { id, limit = 8 } = parsed.data;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { res.json([]); return; }

    const { data: recording, error: recError } = await supabase
      .from("recordings_with_links").select("username, tags, gender").not("links", "is", "null").eq("id", id).single();
    if (recError || !recording) { res.json([]); return; }

    let userTagFreq: Record<string, number> = {};
    let userPerformerFreq: Record<string, number> = {};
    let isAuthenticated = false;
    const seenIds = new Set<string>([id]);

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
        if (!authError && user) {
          isAuthenticated = true;
          const { data: history } = await supabase.from("watch_history").select("recording_id").eq("user_id", user.id).order("watched_at", { ascending: false }).limit(50);
          if (history && history.length > 0) {
            for (const h of history) if (h.recording_id) seenIds.add(h.recording_id);
            const historyIds = history.map((h) => h.recording_id).filter(Boolean);
            if (historyIds.length > 0) {
              const { data: hr } = await supabase.from("recordings_with_links").select("username, tags").in("id", historyIds);
              if (hr) for (const r of hr) {
                if (r.tags) for (const tag of r.tags) userTagFreq[tag] = (userTagFreq[tag] ?? 0) + 1;
                if (r.username) userPerformerFreq[r.username] = (userPerformerFreq[r.username] ?? 0) + 1;
              }
            }
          }
        }
      } catch { /* silent */ }
    }

    // 1. Same performer
    const { data: performerData } = await supabase
      .from("recordings_with_links").select(RELATED_COLS).not("links", "is", "null")
      .neq("id", id).eq("username", recording.username).order("timestamp", { ascending: false }).limit(limit);

    // 2. Tag-based
    let tagResults: any[] = [];
    if (recording.tags && recording.tags.length > 0) {
      const sourceTags = new Set(recording.tags);
      const { data } = await supabase
        .from("recordings_with_links").select(RELATED_COLS).not("links", "is", "null")
        .neq("id", id).neq("username", recording.username).overlaps("tags", recording.tags)
        .order("timestamp", { ascending: false }).limit(limit * 3);

      tagResults = (data ?? []).map((r: any) => {
        let score = (r.tags ?? []).filter((t: string) => sourceTags.has(t)).length * 15;
        if (isAuthenticated) {
          for (const tag of r.tags ?? []) score += (userTagFreq[tag] ?? 0) * 3;
          if (r.username && userPerformerFreq[r.username]) score += userPerformerFreq[r.username] * 10;
          if (recording.gender && r.gender === recording.gender) score += 3;
        }
        score += (r.viewers ?? 0) * 0.01;
        return { ...r, _score: score };
      });
      tagResults.sort((a: any, b: any) => b._score - a._score);
    }

    // 3. Merge
    const merged: any[] = [];
    const seen = new Set(seenIds);
    for (const r of (performerData ?? [])) { if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); } if (merged.length >= limit) { res.json(merged); return; } }
    for (const r of tagResults) { if (merged.length >= limit) break; if (!seen.has(r.id)) { seen.add(r.id); const { _score, ...c } = r; merged.push(c); } }

    // 4. Gender fallback
    if (merged.length < limit && recording.gender) {
      const { data } = await supabase.from("recordings_with_links").select(RELATED_COLS).not("links", "is", "null").neq("id", id).neq("username", recording.username).eq("gender", recording.gender).order("viewers", { ascending: false, nullsFirst: false }).limit(limit * 2);
      for (const r of (data ?? [])) { if (merged.length >= limit) break; if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); } }
    }

    // 5. Popular fallback
    if (merged.length < limit) {
      const { data } = await supabase.from("recordings_with_links").select(RELATED_COLS).not("links", "is", "null").neq("id", id).neq("username", recording.username).order("viewers", { ascending: false, nullsFirst: false }).limit(limit * 3);
      for (const r of (data ?? [])) { if (merged.length >= limit) break; if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); } }
    }

    res.json(merged.slice(0, limit));
  } catch (err) {
    req.log.error({ err, id: req.query.id }, "GET /recordings/related unexpected error");
    res.status(500).json({ error: "Failed to get related recordings" });
  }
});

// ─── SINGLE RECORDING ──────────────────────────────────────────────────────

router.get("/recordings/:id", cache({ ttlSeconds: 600, staleSeconds: 900, tags: ["recordings"] }), async (req, res) => {
  try {
    const parsed = GetRecordingParams.safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }
    const { id } = parsed.data;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { res.status(404).json({ error: "Recording not found" }); return; }

    const { data, error } = await supabase
      .from("recordings_with_links").select("*").not("links", "is", "null").eq("id", id).single();

    if (error) {
      if (error.code === "PGRST116") { res.status(404).json({ error: "Recording not found" }); return; }
      req.log.error({ err: error, id }, "Supabase error fetching recording");
      res.status(500).json({ error: "Failed to fetch recording" });
      return;
    }
    if (!data) { res.status(404).json({ error: "Recording not found" }); return; }

    res.json(data);
  } catch (err) {
    req.log.error({ err, id: req.params.id }, "GET /recordings/:id unexpected error");
    res.status(500).json({ error: "Failed to fetch recording" });
  }
});

export default router;
