import { Router } from "express";
import { GetPerformerParams } from "@workspace/api-zod";
import { supabase } from "../lib/supabase";
import { cache } from "../middleware/cache";

const router = Router();

router.get("/performers", cache({ ttlSeconds: 300, tags: ["performers"] }), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 24));
  const search = (req.query.search as string) || "";
  const gender = (req.query.gender as string) || "";
  const sort = (req.query.sort as string) || "count";

  // Fetch a large batch of recordings to find images for all performers
  // Limit must be >= total recordings to ensure we see every performer
  let query = supabase
    .from("recordings_with_links")
    .select("username, gender, thumbnail_url, sprite_url, preview_url, timestamp, links")
    .not("links", "is", "null")
    .order("timestamp", { ascending: false })
    .limit(1000);

  if (search) {
    query = query.ilike("username", `%${search}%`);
  }
  if (gender) {
    query = query.eq("gender", gender);
  }

  const { data, error } = await query;

  if (error) {
    req.log.error({ err: error }, "Supabase error listing performers");
    res.status(500).json({ error: "Failed to fetch performers" });
    return;
  }

  // Filter out recordings with empty links, then build performer map
  const validData = (data ?? []).filter(
    (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
  );

  // Build performer map — collect all recordings and find the best image
  const performerMap = new Map<
    string,
    {
      username: string;
      recording_count: number;
      latest_thumbnail: string | null;
      gender: string | null;
      latest_timestamp: string | null;
    }
  >();

  for (const row of validData) {
    const existing = performerMap.get(row.username);

    if (!existing) {
      // Try each image field in priority order
      const image = row.thumbnail_url || row.sprite_url || row.preview_url || null;
      performerMap.set(row.username, {
        username: row.username,
        recording_count: 1,
        latest_thumbnail: image,
        gender: row.gender,
        latest_timestamp: row.timestamp,
      });
    } else {
      existing.recording_count += 1;
      // Only update image if we still don't have one
      if (!existing.latest_thumbnail) {
        const image = row.thumbnail_url || row.sprite_url || row.preview_url || null;
        if (image) {
          existing.latest_thumbnail = image;
        }
      }
    }
  }

  let performers = Array.from(performerMap.values());

  // Sort by recording count descending by default
  if (sort === "name") {
    performers.sort((a, b) => a.username.localeCompare(b.username));
  } else {
    performers.sort((a, b) => b.recording_count - a.recording_count);
  }

  // Now apply pagination at the performer level
  const totalPerformers = performers.length;
  const totalPages = Math.ceil(totalPerformers / limit) || 1;
  const start = (page - 1) * limit;
  const pagedPerformers = performers.slice(start, start + limit);

  res.json({
    performers: pagedPerformers,
    total: totalPerformers,
    page,
    limit,
    totalPages,
  });
});

router.get("/performers/:username", cache({ ttlSeconds: 300, tags: ["performers"] }), async (req, res) => {
  const parsed = GetPerformerParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const { username } = parsed.data;

  const { data, error } = await supabase
    .from("recordings_with_links")
    .select("*")
    .eq("username", username)
    .not("links", "is", "null")
    .order("timestamp", { ascending: false });

  const filteredData = (data ?? []).filter(
    (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
  );

  if (error || filteredData.length === 0) {
    res.status(404).json({ error: "Performer not found" });
    return;
  }

  res.json({
    username,
    recording_count: filteredData.length,
    gender: filteredData[0].gender ?? null,
    recordings: filteredData,
  });
});

export default router;
