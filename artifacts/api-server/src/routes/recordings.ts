import { Router } from "express";
import {
  ListRecordingsQueryParams,
  GetRecordingParams,
  ListRelatedRecordingsQueryParams,
} from "@workspace/api-zod";
import { supabase } from "../lib/supabase";

const router = Router();

router.get("/recordings", async (req, res) => {
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

  const offset = (page - 1) * limit;

  let query = supabase
    .from("recordings")
    .select("*", { count: "exact" })
    .range(offset, offset + limit - 1);

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

  res.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
});

router.get("/recordings/related", async (req, res) => {
  const parsed = ListRelatedRecordingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const { id, limit = 8 } = parsed.data;

  const { data: recording, error: recError } = await supabase
    .from("recordings")
    .select("username, tags")
    .eq("id", id)
    .single();

  if (recError || !recording) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const { data, error } = await supabase
    .from("recordings")
    .select("*")
    .neq("id", id)
    .eq("username", recording.username)
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) {
    req.log.error({ err: error }, "Supabase error fetching related recordings");
    res.status(500).json({ error: "Failed to fetch related recordings" });
    return;
  }

  res.json(data ?? []);
});

router.get("/recordings/:id", async (req, res) => {
  const parsed = GetRecordingParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const { id } = parsed.data;

  const { data, error } = await supabase
    .from("recordings")
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
