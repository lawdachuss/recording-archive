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

    // The optimized recordings_with_links view returns NULL (not '{}') for
    // recordings without upload links, so the SQL `.not("links", "is", "null")`
    // filter is sufficient — no JS post-filter or overfetching needed.
    const [countResult, dataResult] = await Promise.all([
      applyFilters(supabase.from("recordings_with_links").select("*", { count: "exact", head: true })),
      applyFilters(supabase.from("recordings_with_links").select(SELECT_COLS))
        .order(orderCol, { ascending, nullsFirst: false })
        .range(offset, offset + normalizedLimit - 1),
    ]);

    if (dataResult.error) {
      req.log.error({ err: dataResult.error }, "Supabase error listing recordings");
      res.status(500).json({ error: "Failed to fetch recordings" });
      return;
    }

    const total = countResult.count ?? 0;
    const rows = dataResult.data ?? [];

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
router.get("/recordings/recommendations", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? "12"), 10) || 12), 100);
    const excludeRaw = typeof req.query.exclude === "string" ? req.query.exclude : "";
    const exclude = excludeRaw.split(",").map(s => s.trim()).filter(Boolean);
    const MAX_PAGES = 10;

    const seenIds = new Set<string>(exclude);

    // ── User profile: signals from history, follows, saves ──
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

          // 1. Watch history — last 100 entries with watch-time signals
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

                // Weight by watch completion ratio × recency (recent = higher weight)
                const progress = Number(h.progress_seconds) || 0;
                const duration = Number(h.duration_seconds) || 1;
                const ratio = duration > 0 ? Math.min(progress / duration, 1) : 0.5;
                const completionWeight = ratio < 0.1 ? 0.1 : ratio < 0.5 ? 0.5 : ratio < 0.8 ? 1 : 2;
                const daysAgo = h.watched_at ? (Date.now() - new Date(h.watched_at).getTime()) / 86400000 : 30;
                const recencyWeight = Math.max(0.5, 1 - daysAgo / 30);
                completionWeights.set(h.recording_id, completionWeight * recencyWeight);
              }
            }
          }

          // 2. Performer follows — strong positive signal
          const { data: follows } = await supabase
            .from("performer_follows")
            .select("performer_username")
            .eq("user_id", uid);

          if (follows) {
            for (const f of follows) {
              if (f.performer_username) followedPerformers.add(f.performer_username);
            }
          }

          // 3. Saved videos (bookmarks) — strong positive signal
          const { data: saved } = await supabase
            .from("saved_videos")
            .select("recording_id")
            .eq("user_id", uid);

          const savedRecordingIds: string[] = [];
          if (saved) {
            for (const s of saved) {
              if (s.recording_id) {
                savedRecordingIds.push(s.recording_id);
                seenIds.add(s.recording_id);
              }
            }
          }

          // 4. Watch later items — interest signal
          const { data: watchLater } = await supabase
            .from("watch_later_items")
            .select("recording_id")
            .eq("user_id", uid);

          const watchLaterRecordingIds: string[] = [];
          if (watchLater) {
            for (const w of watchLater) {
              if (w.recording_id) {
                watchLaterRecordingIds.push(w.recording_id);
                watchLaterIds.add(w.recording_id);
                seenIds.add(w.recording_id);
              }
            }
          }

          // ── Resolve recording metadata for all collected IDs ──
          const allIds = [...new Set([...historyRecordingIds, ...savedRecordingIds, ...watchLaterRecordingIds])];
          if (allIds.length > 0) {
            const { data: metaRows } = await supabase
              .from("recordings_with_links")
              .select("id, username, tags, gender")
              .in("id", allIds);

            if (metaRows) {
              const idToMeta = new Map(metaRows.map((r: any) => [r.id, r]));

              // Watch history: tag + performer + gender frequency (weighted by completion)
              for (const hid of historyRecordingIds) {
                const m = idToMeta.get(hid);
                if (!m) continue;
                const cw = completionWeights.get(hid) ?? 0.5;
                if (m.tags) for (const tag of m.tags) userTagFreq[tag] = (userTagFreq[tag] ?? 0) + cw;
                if (m.username) userPerformerFreq[m.username] = (userPerformerFreq[m.username] ?? 0) + cw;
                if (m.gender) watchedGenders[m.gender] = (watchedGenders[m.gender] ?? 0) + cw;
              }

              // Saved videos: tag + performer affinity (higher weight than watch)
              for (const sid of savedRecordingIds) {
                const m = idToMeta.get(sid);
                if (!m) continue;
                if (m.tags) for (const tag of m.tags) savedTags[tag] = (savedTags[tag] ?? 0) + 2;
                if (m.username) savedPerformers[m.username] = (savedPerformers[m.username] ?? 0) + 2;
              }
            }
          }
        }
      } catch {
        // Auth failed silently — fall back to anonymous logic
      }
    }

    // ── Helper: log-normalized weight ──
    const logWeight = (n: number) => Math.log10(n + 1);

    // ── Helper: diversification (MMR-style) ──
    const diversify = (items: any[], pageSize: number, maxPerPerformer: number = 2): any[] => {
      const result: any[] = [];
      const performerCount: Record<string, number> = {};
      const working = [...items];
      while (result.length < pageSize && working.length > 0) {
        let picked = -1;
        for (let i = 0; i < working.length; i++) {
          const perf = working[i].username || "unknown";
          if ((performerCount[perf] ?? 0) < maxPerPerformer) {
            picked = i;
            break;
          }
        }
        if (picked === -1) picked = 0; // all performers at max — take top remaining
        const item = working.splice(picked, 1)[0];
        const perf = item.username || "unknown";
        performerCount[perf] = (performerCount[perf] ?? 0) + 1;
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
          // Tag affinity from watch history (log-normalized)
          for (const tag of r.tags ?? []) {
            if (userTagFreq[tag]) score += logWeight(userTagFreq[tag]) * 15;
            if (savedTags[tag]) score += logWeight(savedTags[tag]) * 30;
          }

          // Performer affinity
          if (r.username) {
            if (userPerformerFreq[r.username]) score += logWeight(userPerformerFreq[r.username]) * 25;
            if (savedPerformers[r.username]) score += logWeight(savedPerformers[r.username]) * 40;
            if (followedPerformers.has(r.username)) score += 50;
          }

          // Gender preference from watch history
          const preferredGender = Object.entries(watchedGenders).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (preferredGender && r.gender === preferredGender) score += 5;

          // Watch later item match
          if (watchLaterIds.has(r.id)) score += 20;
        }

        // Global popularity (log-normalized to prevent domination)
        score += logWeight(r.viewers ?? 0) * 3;

        // Recency boost (decay over days)
        const ageDays = r.timestamp ? (Date.now() - new Date(r.timestamp).getTime()) / 86400000 : 999;
        score += Math.max(0, 30 - ageDays * 0.5);

        // Random jitter (±4) so each page load shuffles similarly-scored items
        score += (Math.random() - 0.5) * 8;

        scored.push({ ...r, _score: score });
        seenIds.add(r.id);
      }
    };

    if (isAuthenticated) {
      // Personalized: pull a broad recent window and rank by user interest.
      const POOL = limit * MAX_PAGES;
      const { data: poolRows } = await supabase
        .from("recordings_with_links")
        .select("*")
        .not("links", "is", "null")
        .order("timestamp", { ascending: false })
        .limit(POOL * 2);
      addScored(poolRows, 0);
      scored.sort((a: any, b: any) => b._score - a._score);
    } else {
      // Anonymous: diverse parallel queries
      const POOL = limit * MAX_PAGES;

      const [newestResult, tagDiverseResult, popularResult, categoryResult] = await Promise.all([
        // Newest recordings (high base score)
        supabase.from("recordings_with_links").select("*").not("links", "is", "null").order("timestamp", { ascending: false }).limit(POOL),

        // Tag-diverse: sample from different tags for variety
        supabase.from("recordings_with_links").select("*").not("links", "is", "null").order("viewers", { ascending: false, nullsFirst: false }).limit(POOL),

        // Most viewed (popular)
        supabase.from("recordings_with_links").select("*").not("links", "is", "null").order("viewers", { ascending: false, nullsFirst: false }).limit(POOL),

        // Recent popular mix
        supabase.from("recordings_with_links").select("*").not("links", "is", "null").order("timestamp", { ascending: false }).limit(POOL),
      ]);

      // Reduce tag-diverse set to at most 1 per tag for variety
      const tagDiverseRows = tagDiverseResult.data ?? [];
      const seenTags = new Set<string>();
      const dedupedTagRows: any[] = [];
      for (const r of tagDiverseRows) {
        const tagKey = (r.tags ?? []).slice(0, 2).sort().join(",");
        if (!seenTags.has(tagKey)) {
          seenTags.add(tagKey);
          dedupedTagRows.push(r);
        }
        if (dedupedTagRows.length >= POOL) break;
      }

      addScored(newestResult.data, 80);
      addScored(dedupedTagRows, 50);
      addScored(popularResult.data, 20);
      addScored(categoryResult.data, 1);

      scored.sort((a: any, b: any) => b._score - a._score);
    }

    // Apply diversity re-ranking: max 2 per performer per page
    const diversified = diversify(scored, limit * MAX_PAGES, 2);

    const totalItems = diversified.length;
    const totalPages = Math.min(Math.ceil(totalItems / limit) || 1, MAX_PAGES);
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;
    const pageRows = diversified.slice(offset, offset + limit).map(({ _score, ...r }: any) => r);

    res.json({
      data: pageRows,
      total: totalItems,
      page: safePage,
      limit,
      totalPages,
    });
  } catch (err) {
    req.log.error({ err }, "GET /recordings/recommendations unexpected error");
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
});

router.get("/recordings/random", async (req, res) => {
  try {
    // The optimized view returns NULL links for recordings without links,
    // so the SQL `.not("links", "is", "null")` filter is sufficient.
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

    // The optimized view returns NULL links for recordings without links,
    // so the SQL `.not("links", "is", "null")` filter is sufficient.
    // ── 1. Same performer recordings ──
    const { data: performerData } = await supabase
      .from("recordings_with_links")
      .select("*")
      .not("links", "is", "null")
      .neq("id", id)
      .eq("username", recording.username)
      .order("timestamp", { ascending: false })
      .limit(limit);

    const performerResults = performerData ?? [];

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

      tagResults = tagData ?? [];

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

      for (const r of (genderData ?? [])) {
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

      for (const r of (popularData ?? [])) {
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

    res.json(data);
  } catch (err) {
    req.log.error({ err, id: req.params.id }, "GET /recordings/:id unexpected error");
    res.status(500).json({ error: "Failed to fetch recording" });
  }
});

export default router;
