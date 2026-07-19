import { Router } from "express";
import {
  ListRecordingsQueryParams,
  GetRecordingParams,
  ListRelatedRecordingsQueryParams,
} from "@workspace/api-zod";
import { supabase } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";

const router = Router();

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
    const offset = (normalizedPage - 1) * normalizedLimit;

    const orderCol =
      sort === "oldest" ? "timestamp" :
      sort === "largest" ? "filesize" :
      sort === "popular" ? "viewers" :
      "timestamp";
    const ascending = sort === "oldest";

    // Apply shared filters to any Supabase query builder
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyFilters(q: any) {
      q = q.not("links", "is", "null");
      if (search?.trim()) {
        const term = search.trim();
        q = q.or(`username.ilike.%${term}%,room_title.ilike.%${term}%,filename.ilike.%${term}%`);
      }
      if (tags) {
        const tagList = tags.split(",").map((t: string) => t.trim()).filter(Boolean);
        if (tagList.length > 0) q = q.contains("tags", tagList);
      }
      if (gender) q = q.eq("gender", gender);
      if (username) q = q.eq("username", username);
      if (resolution) q = q.eq("resolution", resolution);
      return q;
    }

    const SELECT_COLS = "id,channel_id,username,filename,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,embed_url,preview_url,instance_id,created_at,updated_at,links";

    const validLinks = (r: any) =>
      r.links && typeof r.links === "object" && Object.keys(r.links).length > 0;

    const OVERFETCH_MULTIPLIER = 4;

    const [countResult, dataResult] = await Promise.all([
      applyFilters(supabase.from("recordings_with_links").select("*", { count: "exact", head: true })),
      applyFilters(supabase.from("recordings_with_links").select(SELECT_COLS))
        .order(orderCol, { ascending, nullsFirst: false })
        .range(offset, offset + normalizedLimit * OVERFETCH_MULTIPLIER - 1),
    ]);

    if (dataResult.error) {
      req.log.error({ err: dataResult.error }, "Supabase error listing recordings");
      res.status(500).json({ error: "Failed to fetch recordings" });
      return;
    }

    const total = countResult.count ?? 0;
    const rows = (dataResult.data ?? []).filter(validLinks).slice(0, normalizedLimit);

    res.json({
      data: rows,
      total,
      page: normalizedPage,
      limit: normalizedLimit,
      totalPages: Math.ceil(total / normalizedLimit),
    });
  } catch (err) {
    req.log.error({ err }, "GET /recordings unexpected error");
    res.status(500).json({ error: "Failed to fetch recordings" });
  }
});
router.get("/recordings/random", async (req, res) => {
  try {
    // Fetch all valid recording IDs (JS post-filter to avoid JSONB count bugs)
    const { data: allRows, error: fetchError } = await supabase
      .from("recordings_with_links")
      .select("id, links")
      .not("links", "is", "null");

    if (fetchError) {
      req.log.error({ err: fetchError }, "Supabase error getting recordings for random");
      res.status(500).json({ error: "Failed to get random recording" });
      return;
    }

    const validIds = (allRows ?? [])
      .filter((r: any) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0)
      .map((r: any) => r.id);

    if (validIds.length === 0) {
      req.log.error("No recordings with valid links found");
      res.status(500).json({ error: "Failed to get random recording" });
      return;
    }

    const randomId = validIds[Math.floor(Math.random() * validIds.length)];
    res.json({ id: randomId });
  } catch (err) {
    req.log.error({ err }, "GET /recordings/random unexpected error");
    res.status(500).json({ error: "Failed to get random recording" });
  }
});

router.get("/recordings/related", async (req, res) => {
  try {
    const parsed = ListRelatedRecordingsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }

    const { id, limit = 8 } = parsed.data;

    // ── Fetch source recording ──
    const { data: recording, error: recError } = await supabase
      .from("recordings_with_links")
      .select("username, tags, gender")
      .not("links", "is", "null")
      .eq("id", id)
      .single();

    if (recError || !recording) {
      req.log.error({ err: recError, id }, "Failed to fetch source recording");
      res.status(500).json({ error: "Failed to fetch related recordings" });
      return;
    }

    // ── Authenticated user personalization ──
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
          const { data: history } = await supabase
            .from("watch_history")
            .select("recording_id, metadata")
            .eq("user_id", user.id)
            .order("watched_at", { ascending: false })
            .limit(50);

          if (history && history.length > 0) {
            for (const h of history) {
              if (h.recording_id) seenIds.add(h.recording_id);
            }

            const historyIds = history.map((h) => h.recording_id).filter(Boolean);
            if (historyIds.length > 0) {
              const { data: historyRecordings } = await supabase
                .from("recordings_with_links")
                .select("username, tags")
                .in("id", historyIds);

              if (historyRecordings) {
                for (const hr of historyRecordings) {
                  if (hr.tags) {
                    for (const tag of hr.tags) {
                      userTagFreq[tag] = (userTagFreq[tag] ?? 0) + 1;
                    }
                  }
                  if (hr.username) {
                    userPerformerFreq[hr.username] = (userPerformerFreq[hr.username] ?? 0) + 1;
                  }
                }
              }
            }
          }
        }
      } catch {
        // Auth check failed silently — fall back to anonymous
      }
    }

    const validLinks = (r: any) =>
      r.links && typeof r.links === "object" && Object.keys(r.links).length > 0;

    // ── 1. Same performer recordings ──
    const { data: performerData } = await supabase
      .from("recordings_with_links")
      .select("*")
      .not("links", "is", "null")
      .neq("id", id)
      .eq("username", recording.username)
      .order("timestamp", { ascending: false })
      .limit(limit);

    const performerResults = (performerData ?? []).filter(validLinks);

    // ── 2. Tag-based recordings (any overlapping tag) ──
    let tagResults: any[] = [];
    if (recording.tags && recording.tags.length > 0) {
      const sourceTags = new Set(recording.tags);
      const { data: tagData } = await supabase
        .from("recordings_with_links")
        .select("*")
        .not("links", "is", "null")
        .neq("id", id)
        .neq("username", recording.username)
        .filter("tags", "?|", `{${recording.tags.join(",")}}`)
        .order("timestamp", { ascending: false })
        .limit(limit * 3);

      tagResults = (tagData ?? []).filter(validLinks);

      // Score: shared tag count + personalization weight
      tagResults = tagResults.map((r: any) => {
        let score = 0;
        const sharedTags = (r.tags ?? []).filter((t: string) => sourceTags.has(t));
        score += sharedTags.length * 15;

        if (isAuthenticated) {
          for (const tag of r.tags ?? []) {
            score += (userTagFreq[tag] ?? 0) * 3;
          }
          if (r.username && userPerformerFreq[r.username]) {
            score += userPerformerFreq[r.username] * 10;
          }
          if (recording.gender && r.gender === recording.gender) {
            score += 3;
          }
        }

        score += (r.viewers ?? 0) * 0.01;
        return { ...r, _score: score };
      });

      tagResults.sort((a: any, b: any) => b._score - a._score);
    }

    // ── 3. Merge: same-performer first, then tag-based ──
    const merged: any[] = [];
    const seen = new Set(seenIds);

    for (const r of performerResults) {
      if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
      if (merged.length >= limit) { res.json(merged); return; }
    }

    for (const r of tagResults) {
      if (merged.length >= limit) break;
      if (!seen.has(r.id)) {
        seen.add(r.id);
        const { _score, ...clean } = r;
        merged.push(clean);
      }
    }

    // ── 4. Fallback: gender-based popular ──
    if (merged.length < limit && recording.gender) {
      const { data: genderData } = await supabase
        .from("recordings_with_links")
        .select("*")
        .not("links", "is", "null")
        .neq("id", id)
        .neq("username", recording.username)
        .eq("gender", recording.gender)
        .order("viewers", { ascending: false, nullsFirst: false })
        .limit(limit * 2);

      for (const r of (genderData ?? []).filter(validLinks)) {
        if (merged.length >= limit) break;
        if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
      }
    }

    // ── 5. Final fallback: popular recordings ──
    if (merged.length < limit) {
      const { data: popularData } = await supabase
        .from("recordings_with_links")
        .select("*")
        .not("links", "is", "null")
        .neq("id", id)
        .neq("username", recording.username)
        .order("viewers", { ascending: false, nullsFirst: false })
        .limit(limit * 3);

      for (const r of (popularData ?? []).filter(validLinks)) {
        if (merged.length >= limit) break;
        if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
      }
    }

    res.json(merged.slice(0, limit));
  } catch (err) {
    req.log.error({ err, id: req.query.id }, "GET /recordings/related unexpected error");
    res.status(500).json({ error: "Failed to fetch related recordings" });
  }
});

router.get("/recordings/:id", cache({ ttlSeconds: 600, staleSeconds: 900, tags: ["recordings"] }), async (req, res) => {
  try {
    const parsed = GetRecordingParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }

    const { id } = parsed.data;

    const { data, error } = await supabase
      .from("recordings_with_links")
      .select("*")
      .not("links", "is", "null")
      .eq("id", id)
      .single();

    if (error) {
      req.log.error({ err: error, id }, "Supabase error fetching recording");
      res.status(500).json({ error: "Failed to fetch recording" });
      return;
    }
    if (!data) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    // Verify the recording has non-empty links
    if (!data.links || typeof data.links !== "object" || Object.keys(data.links).length === 0) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err, id: req.params.id }, "GET /recordings/:id unexpected error");
    res.status(500).json({ error: "Failed to fetch recording" });
  }
});

export default router;
