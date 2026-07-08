import { Router } from "express";
import { GetPerformerParams } from "@workspace/api-zod";
import { supabase } from "../lib/supabase";
import { cache } from "../middleware/cache";

const COOKIES = process.env.COOKIES ?? "";

async function fetchWithCookies(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: COOKIES,
      },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, property: string): string | null {
  const regex = new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']*)["']`, "i");
  const match = html.match(regex);
  return match ? match[1] : null;
}

function extractTextAfter(html: string, pattern: string): string | null {
  const regex = new RegExp(`${pattern}\\s*[:]?\\s*([^<]+)`, "i");
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

interface LookupResult {
  exists: boolean;
  platform: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_online?: boolean;
  last_seen?: string;
  room_title?: string;
  viewer_count?: number;
  follower_count?: number;
  profile_url: string;
  in_archive: boolean;
  archive_thumbnail?: string | null;
  archive_recording_count?: number;
  archive_last_recording?: string | null;
  platform_check_failed?: boolean;
}

function parseCount(str: string): number {
  const s = str.toLowerCase().replace(/,/g, "");
  if (s.endsWith("m")) return parseFloat(s) * 1_000_000;
  if (s.endsWith("k")) return parseFloat(s) * 1_000;
  return parseFloat(s) || 0;
}

function performerExistsOnPlatform(html: string, username: string, platform: string): boolean {
  const bodyLower = html.toLowerCase();
  const usernameLower = username.toLowerCase();

  if (platform === "chaturbate") {
    if (bodyLower.includes(`data-room="${usernameLower}"`)) return true;
    if (bodyLower.includes(`data-username="${usernameLower}"`)) return true;
    if (/class="[^"]*profile-avatar[^"]*"/i.test(html)) return true;
    if (/class="[^"]*panel-avatar[^"]*"/i.test(html)) return true;
    if (/class="[^"]*room-status[^"]*"/i.test(html)) return true;
  }

  if (platform === "stripchat") {
    if (bodyLower.includes(`"username":"${usernameLower}"`)) return true;
    if (/class="[^"]*model-avatar[^"]*"/i.test(html)) return true;
    if (/class="[^"]*model-card[^"]*"/i.test(html)) return true;
  }

  const ogTitle = extractMetaContent(html, "og:title");
  if (ogTitle && ogTitle.toLowerCase().includes(usernameLower)) return true;

  const ogDescription = extractMetaContent(html, "og:description");
  if (ogDescription && ogDescription.toLowerCase().includes(usernameLower)) return true;

  const ogUrl = extractMetaContent(html, "og:url");
  if (ogUrl && ogUrl.toLowerCase().includes(usernameLower)) return true;

  if (bodyLower.includes(usernameLower) && (bodyLower.includes("is online") || bodyLower.includes("last online") || bodyLower.includes("live now"))) return true;

  return false;
}

const router = Router();

router.get("/performers/lookup", cache({ ttlSeconds: 120, staleSeconds: 300, tags: ["performers", "search"] }), async (req, res) => {
  try {
    const platform = (req.query.platform as string)?.toLowerCase();
    const username = (req.query.username as string)?.toLowerCase().trim();

    if (!platform || !username) {
      res.status(400).json({ error: "platform and username are required" });
      return;
    }
    if (!["chaturbate", "stripchat"].includes(platform)) {
      res.status(400).json({ error: 'platform must be "chaturbate" or "stripchat"' });
      return;
    }

    const profileUrl = platform === "chaturbate"
      ? `https://chaturbate.com/${username}/`
      : `https://stripchat.com/${username}`;

    const result: LookupResult = {
      exists: false,
      platform,
      username,
      profile_url: profileUrl,
      in_archive: false,
    };

    // 1. Check local archive first
    try {
      const { data: archiveData } = await supabase
        .from("recordings_with_links")
        .select("thumbnail_url, sprite_url, preview_url, timestamp, username")
        .eq("username", username)
        .not("links", "is", "null")
        .order("timestamp", { ascending: false })
        .limit(50);

      if (archiveData && archiveData.length > 0) {
        result.in_archive = true;
        result.archive_recording_count = archiveData.length;
        result.archive_last_recording = archiveData[0].timestamp;
        result.archive_thumbnail =
          archiveData[0].thumbnail_url || archiveData[0].sprite_url || archiveData[0].preview_url || null;
      }
    } catch {
      // Archive check failed, continue with platform check
    }

    // 2. Fetch platform page
    const html = await fetchWithCookies(profileUrl);
    if (!html) {
      if (result.in_archive) {
        result.exists = true;
        result.platform_check_failed = true;
        res.json(result);
        return;
      }
      res.json(result);
      return;
    }

    // 3. Positive detection — look for performer-specific elements on the page
    if (performerExistsOnPlatform(html, username, platform)) {
      result.exists = true;
    } else {
      // No positive signals — check <title> for not-found patterns
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1].toLowerCase() : "";
      const notFoundTitles = ["page not found", "not found", "404", "error"];
      const isNotFound = notFoundTitles.some((p) => title.includes(p));

      if (isNotFound) {
        req.log.warn({ title, username, platform, htmlSample: html.slice(0, 500) }, "performer-lookup: title suggests not found");

        if (result.in_archive) {
          result.exists = true;
          result.platform_check_failed = true;
          res.json(result);
          return;
        }
        result.exists = false;
        res.json(result);
        return;
      }

      // Page loaded without positive signals but title doesn't say "not found"
      result.exists = true;
      req.log.warn({ username, platform, title, htmlSample: html.slice(0, 300) }, "performer-lookup: no positive signals but page loaded");
    }

    // 4. Parse performer details
    const bodyLower = html.toLowerCase();
    result.display_name = extractMetaContent(html, "og:title") || username;
    result.avatar_url = extractMetaContent(html, "og:image") ?? undefined;

    if (bodyLower.includes("is online") || bodyLower.includes("online now") || bodyLower.includes("live now")) {
      result.is_online = true;
    } else {
      result.is_online = false;
      const lastSeenMatch = html.match(/(?:last\s+(?:online|seen|live)|offline)\s*[:]?\s*([^<]+)/i);
      if (lastSeenMatch) {
        result.last_seen = lastSeenMatch[1].trim();
      }
    }

    const ogDesc = extractMetaContent(html, "og:description");
    if (ogDesc) {
      result.room_title = ogDesc;
    }

    if (result.is_online) {
      const viewerMatch = html.match(/(\d[\d,]*)\s*(?:viewers?|watching)/i);
      if (viewerMatch) {
        result.viewer_count = parseInt(viewerMatch[1].replace(/,/g, ""), 10);
      }
    }

    const followerMatch = html.match(/(\d[\d,.]*[kKmM]?)\s*(?:followers?|fans)/i);
    if (followerMatch) {
      result.follower_count = parseCount(followerMatch[1]);
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "GET /performers/lookup error");
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.get("/performers", cache({ ttlSeconds: 600, staleSeconds: 900, tags: ["performers", "recordings", "search"] }), async (req, res) => {
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

router.get("/performers/:username", cache({ ttlSeconds: 900, staleSeconds: 1800, tags: ["performers", "recordings"] }), async (req, res) => {
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
