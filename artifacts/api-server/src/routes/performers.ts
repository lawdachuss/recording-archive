import { Router } from "express";
import { GetPerformerParams } from "@workspace/api-zod";
import { supabase } from "../lib/supabase";
import { cache } from "../middleware/cache";

const router = Router();

router.get("/performers", cache({ ttlSeconds: 300, tags: ["performers"] }), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 24));
    const search = (req.query.search as string) || "";
    const gender = (req.query.gender as string) || "";
    const sort = (req.query.sort as string) || "count";

    let query = supabase
      .from("recordings_with_links")
      .select("username, gender, thumbnail_url, sprite_url, preview_url, timestamp, links")
      .not("links", "is", "null")
      .order("timestamp", { ascending: false });

    if (search) query = query.ilike("username", `%${search}%`);
    if (gender) query = query.eq("gender", gender);

    // Fetch a generous window of raw rows to capture enough unique performers
    // after grouping. Without a performer-specific table, we must over-fetch.
    const FETCH_LIMIT = 50_000;
    query = query.limit(FETCH_LIMIT);

    const { data, error } = await query;

    if (error) {
      req.log.error({ err: error }, "Supabase error listing performers");
      res.status(500).json({ error: "Failed to fetch performers" });
      return;
    }

    // Post-filter: only include recordings with non-empty links
    const validRows = (data ?? []).filter(
      (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
    );

    const performerMap = new Map<
      string,
      {
        username: string;
        recording_count: number;
        latest_thumbnail: string | null;
        sprite_url: string | null;
        gender: string | null;
        latest_timestamp: string | null;
      }
    >();

    for (const row of validRows) {
      const existing = performerMap.get(row.username);
      if (!existing) {
        const image = row.thumbnail_url || row.sprite_url || row.preview_url || null;
        performerMap.set(row.username, {
          username: row.username,
          recording_count: 1,
          latest_thumbnail: image,
          sprite_url: row.sprite_url,
          gender: row.gender,
          latest_timestamp: row.timestamp,
        });
      } else {
        existing.recording_count += 1;
        if (!existing.latest_thumbnail) {
          const image = row.thumbnail_url || row.sprite_url || row.preview_url || null;
          if (image) {
            existing.latest_thumbnail = image;
            existing.sprite_url = row.sprite_url;
          }
        }
      }
    }

    let performers = Array.from(performerMap.values());
    if (sort === "name") {
      performers.sort((a, b) => a.username.localeCompare(b.username));
    } else {
      performers.sort((a, b) => b.recording_count - a.recording_count);
    }

    const totalPerformers = performers.length;
    const totalPages = Math.ceil(totalPerformers / limit) || 1;
    const start = (page - 1) * limit;
    const pagedPerformers = performers.slice(start, start + limit);

    res.json({ performers: pagedPerformers, total: totalPerformers, page, limit, totalPages });
  } catch (err) {
    req.log.error({ err }, "GET /performers unexpected error");
    res.status(500).json({ error: "Failed to fetch performers" });
  }
});

router.get("/performers/:username", cache({ ttlSeconds: 300, tags: ["performers"] }), async (req, res) => {
  try {
    const parsed = GetPerformerParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }

    const { username } = parsed.data;

    const { data, error } = await supabase
      .from("recordings_with_links")
      .select("*")
      .not("links", "is", "null")
      .eq("username", username)
      .order("timestamp", { ascending: false });

    if (error) {
      req.log.error({ err: error, username }, "Supabase error fetching performer");
      res.status(500).json({ error: "Failed to fetch performer" });
      return;
    }

    // Post-filter: only include recordings with non-empty links
    const validRecordings = (data ?? []).filter(
      (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
    );

    // Return 404 if no recordings with valid links exist for this performer
    if (validRecordings.length === 0) {
      res.status(404).json({ error: "Performer not found" });
      return;
    }

    res.json({
      username,
      recording_count: validRecordings.length,
      gender: validRecordings[0].gender ?? null,
      recordings: validRecordings,
    });
  } catch (err) {
    req.log.error({ err, username: req.params.username }, "GET /performers/:username unexpected error");
    res.status(500).json({ error: "Failed to fetch performer" });
  }
});

export default router;
