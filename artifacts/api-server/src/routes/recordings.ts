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
  const parsed = ListRecordingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const {
    page = 1,
    limit = 24,
    search,
    tags,
    gender,
    username,
    resolution,
    sort,
  } = parsed.data;

  const fetchLimit = limit * 3;
  const offset = (page - 1) * fetchLimit;

  let query = supabase
    .from("recordings_with_links")
    .select("*", { count: "exact" })
    .not("links", "is", "null")
    .range(offset, offset + fetchLimit - 1);

  if (search) {
    query = query.or(
      `username.ilike.%${search}%,room_title.ilike.%${search}%,filename.ilike.%${search}%`,
    );
  }

  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      query = query.contains("tags", tagList);
    }
  }

  if (gender) {
    query = query.eq("gender", gender);
  }

  if (username) {
    query = query.eq("username", username);
  }

  if (resolution) {
    query = query.eq("resolution", resolution);
  }

  if (sort === "oldest") {
    query = query.order("timestamp", { ascending: true });
  } else if (sort === "largest") {
    query = query.order("filesize", { ascending: false });
  } else if (sort === "popular") {
    query = query.order("viewers", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("timestamp", { ascending: false });
  }

  const { data, count, error } = await query;

  if (error) {
    req.log.error({ err: error }, "Supabase error listing recordings");
    res.status(500).json({ error: "Failed to fetch recordings" });
    return;
  }

  const allWithLinks = (data ?? []).filter(
    (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
  );
  const excludedCount = (data ?? []).length - allWithLinks.length;

  res.json({
    data: allWithLinks.slice(0, limit),
    total: (count ?? 0) - excludedCount,
    page,
    limit,
  });
});

router.get("/recordings/random", async (_req, res) => {
  const { count, error: countError } = await supabase
    .from("recordings_with_links")
    .select("*", { count: "exact", head: true })
    .not("links", "is", "null");

  if (countError || !count) {
    res.status(500).json({ error: "Failed to get recording count" });
    return;
  }

  const randomOffset = Math.floor(Math.random() * count);

  const { data, error } = await supabase
    .from("recordings_with_links")
    .select("id")
    .not("links", "is", "null")
    .range(randomOffset, randomOffset)
    .single();

  if (error || !data) {
    res.status(500).json({ error: "Failed to get random recording" });
    return;
  }

  res.json({ id: data.id });
});

router.get("/recordings/related", cache({ ttlSeconds: 300, tags: ["recordings"] }), async (req, res) => {
  const parsed = ListRelatedRecordingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const { id, limit = 8 } = parsed.data;

  const { data: recording, error: recError } = await supabase
    .from("recordings_with_links")
    .select("username, tags")
    .eq("id", id)
    .single();

  if (recError || !recording) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const { data, error } = await supabase
    .from("recordings_with_links")
    .select("*")
    .neq("id", id)
    .eq("username", recording.username)
    .not("links", "is", "null")
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) {
    req.log.error({ err: error }, "Supabase error fetching related recordings");
    res.status(500).json({ error: "Failed to fetch related recordings" });
    return;
  }

  const filteredData = (data ?? []).filter(
    (r) => r.links && typeof r.links === "object" && Object.keys(r.links).length > 0,
  );

  res.json(filteredData);
});

router.get("/recordings/:id", cache({ ttlSeconds: 300, tags: ["recordings"] }), async (req, res) => {
  const parsed = GetRecordingParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const { id } = parsed.data;

  const { data, error } = await supabase
    .from("recordings_with_links")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  res.json(data);
});

export default router;
