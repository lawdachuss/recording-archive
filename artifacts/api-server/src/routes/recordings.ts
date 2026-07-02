import { Router } from "express";
import {
  ListRecordingsQueryParams,
  GetRecordingParams,
  ListRelatedRecordingsQueryParams,
} from "@workspace/api-zod";
import { supabase } from "../lib/supabase";
import { cache } from "../middleware/cache";

const router = Router();

router.get("/recordings", cache({ ttlSeconds: 60, tags: ["recordings"] }), async (req, res) => {
  try {
    const parsed = ListRecordingsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }

    const { page = 1, limit = 24, search, tags, gender, username, resolution, sort } = parsed.data;

    const offset = (page - 1) * limit;

    // ── Helpers ──────────────────────────────────────────────────
    const maybeSearch = (q: any) =>
      search ? q.or(`username.ilike.%${search}%,room_title.ilike.%${search}%,filename.ilike.%${search}%`) : q;
    const maybeTags = (q: any) => {
      if (!tags) return q;
      const list = tags.split(",").map((t) => t.trim()).filter(Boolean);
      return list.length > 0 ? q.contains("tags", list) : q;
    };
    const maybeGender = (q: any) => (gender ? q.eq("gender", gender) : q);
    const maybeUsername = (q: any) => (username ? q.eq("username", username) : q);
    const maybeResolution = (q: any) => (resolution ? q.eq("resolution", resolution) : q);

    function applyFilters(q: any) {
      return maybeResolution(maybeUsername(maybeGender(maybeTags(maybeSearch(q)))));
    }

    // ── Accurate count via JS post-filter ─────────────────────────
    // PostgREST count: "exact" can silently ignore JSONB filters
    // (.neq, .eq), so we fetch ALL matching (id, links) rows and count
    // valid ones in application code.
    let countQuery: any = supabase
      .from("recordings_with_links")
      .select("id, links")
      .not("links", "is", "null");
    countQuery = applyFilters(countQuery);

    const { data: allRows, error: countErr } = await countQuery;

    if (countErr) {
      req.log.error({ err: countErr }, "Supabase error counting recordings");
      res.status(500).json({ error: "Failed to fetch recordings" });
      return;
    }

    const totalValid = (allRows ?? []).filter(
      (row: any) => row.links && typeof row.links === "object" && Object.keys(row.links).length > 0,
    ).length;

    // ── Data query ───────────────────────────────────────────────
    let query = applyFilters(
      supabase
        .from("recordings_with_links")
        .select("*")
        .not("links", "is", "null")
        .range(offset, offset + limit - 1),
    );

    if (sort === "oldest") query = query.order("timestamp", { ascending: true });
    else if (sort === "largest") query = query.order("filesize", { ascending: false });
    else if (sort === "popular") query = query.order("viewers", { ascending: false, nullsFirst: false });
    else query = query.order("timestamp", { ascending: false });

    const { data, error } = await query;

    if (error) {
      req.log.error({ err: error }, "Supabase error listing recordings");
      res.status(500).json({ error: "Failed to fetch recordings" });
      return;
    }

    // Safety net: remove any empty-link rows that slipped through
    const validData = (data ?? []).filter(
      (row: any) => row.links && typeof row.links === "object" && Object.keys(row.links).length > 0,
    );

    res.json({
      data: validData.slice(0, limit),
      total: totalValid,
      page,
      limit,
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

router.get("/recordings/related", cache({ ttlSeconds: 300, tags: ["recordings"] }), async (req, res) => {
  try {
    const parsed = ListRelatedRecordingsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }

    const { id, limit = 8 } = parsed.data;

    const { data: recording, error: recError } = await supabase
      .from("recordings_with_links")
      .select("username, tags")
      .not("links", "is", "null")
      .eq("id", id)
      .single();

    if (recError) {
      req.log.error({ err: recError, id }, "Supabase error fetching source recording for related");
      res.status(500).json({ error: "Failed to fetch related recordings" });
      return;
    }
    if (!recording) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }

    const { data, error } = await supabase
      .from("recordings_with_links")
      .select("*")
      .not("links", "is", "null")
      .neq("id", id)
      .eq("username", recording.username)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) {
      req.log.error({ err: error, id }, "Supabase error fetching related recordings");
      res.status(500).json({ error: "Failed to fetch related recordings" });
      return;
    }

    // Post-filter: only include recordings with non-empty links
    const filteredData = (data ?? []).filter(
      (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
    );
    res.json(filteredData);
  } catch (err) {
    req.log.error({ err, id: req.query.id }, "GET /recordings/related unexpected error");
    res.status(500).json({ error: "Failed to fetch related recordings" });
  }
});

router.get("/recordings/:id", cache({ ttlSeconds: 300, tags: ["recordings"] }), async (req, res) => {
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
