import { Router } from "express";
import { GetPerformerParams } from "@workspace/api-zod";
import { supabase } from "../lib/supabase.js";
import { db, sql } from "@workspace/db";
import { cache } from "../middleware/cache.js";

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

function extractMetaContent(html: string, propertyOrName: string): string | null {
  // Try <meta property="og:..." content="..."> first
  const propRegex = new RegExp(`<meta\\s+property=["']${propertyOrName}["']\\s+content=["']([^"']*)["']`, "i");
  let match = html.match(propRegex);
  if (match) return match[1];
  // Fallback: <meta name="..." content="...">
  const nameRegex = new RegExp(`<meta\\s+name=["']${propertyOrName}["']\\s+content=["']([^"']*)["']`, "i");
  match = html.match(nameRegex);
  if (match) return match[1];
  // Fallback: <meta content="..." property="..."> (reversed attributes)
  const revRegex = new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+property=["']${propertyOrName}["']`, "i");
  match = html.match(revRegex);
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
    // Stripchat embeds a global JSON state that lists the logged-in viewer and
    // recommended models, so a bare `"username":"..."` substring or a generic
    // `model-avatar`/`model-card` class is NOT proof the requested performer
    // owns this page. Only trust the canonical profile URL, which Stripchat
    // sets to https://stripchat.com/{exact-username} for the real model.
    //
    // We try multiple patterns to handle different Stripchat page formats:
    const expectedUrls = [
      `https://stripchat.com/${usernameLower}`,
      `https://www.stripchat.com/${usernameLower}`,
    ];

    // 1. Check og:url meta tag
    const canonical = extractMetaContent(html, "og:url");
    if (canonical) {
      const normalized = canonical.replace(/\/+$/, "").toLowerCase();
      if (expectedUrls.some((u) => normalized === u)) return true;
    }

    // 2. Check <link rel="canonical">
    const canonicalLink = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i))?.[1];
    if (canonicalLink) {
      const normalized = canonicalLink.replace(/\/+$/, "").toLowerCase();
      if (expectedUrls.some((u) => normalized === u)) return true;
    }

    // 3. Check data attributes that Stripchat uses on model profile pages
    // Stripchat often embeds profile-specific data attributes on the model page
    if (bodyLower.includes(`data-model-username="${usernameLower}"`)) return true;
    if (bodyLower.includes(`data-username="${usernameLower}"`)) return true;
    if (bodyLower.includes(`data-profile="${usernameLower}"`)) return true;

    // 4. Check for profile links pointing to this exact username
    const profileLinkRegex = new RegExp(`href=["']https://stripchat\.com/${usernameLower}(?:/|"|')`, "i");
    if (profileLinkRegex.test(html)) return true;

    // 5. Check twitter:site or og:site_name with matching username
    const twitterSite = extractMetaContent(html, "twitter:site");
    if (twitterSite && twitterSite.toLowerCase().includes(usernameLower)) {
      // Only trust if it also has performer-specific og:image
      const ogImage = extractMetaContent(html, "og:image");
      if (ogImage && !ogImage.includes("default") && !ogImage.includes("logo")) return true;
    }
  }

  // NOTE: The generic fallthroughs below are unreliable for Stripchat and must
  // NOT be used to assert existence there — Stripchat pages embed other models'
  // usernames in og:title/og:description and "live now" listings, which produce
  // false positives. For Stripchat the canonical-URL check above is authoritative.
  if (platform === "stripchat") return false;

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

      // Page loaded without positive signals and title doesn't say "not found".
      // For Stripchat, absence of a canonical profile match means this isn't the
      // performer's page (e.g. a soft-404 / landing page), so do NOT assume exists.
      if (platform === "stripchat") {
        result.exists = false;
        res.json(result);
        return;
      }
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

    // Use SQL aggregation with GROUP BY instead of loading ALL recordings into
    // memory. With 8,000+ recordings, the old fetchAll approach loaded every
    // row, built a Map in JS, and was O(n) in both time and memory.
    //
    // We use a subquery to find each performer's latest recording (for thumbnail)
    // and count, then paginate the results server-side.
    const genderFilter = gender ? sql`WHERE gender = ${gender}` : sql``;
    const searchFilter = search ? sql`AND LOWER(username) LIKE ${`%${search.toLowerCase()}%`}` : sql``;

    // Step 1: Get total count of distinct performers matching filters
    const countResult = await db.execute(sql`
      SELECT COUNT(DISTINCT username)::int AS count
      FROM recordings_with_links
      WHERE links IS NOT NULL
      ${genderFilter}
      ${searchFilter}
    `);
    const totalPerformers = (countResult.rows[0] as any)?.count ?? 0;

    // Step 2: Get paginated performer list with recording counts and latest thumbnails
    // Using a window function to get the latest recording per performer efficiently.
    const sortClause = sort === "name"
      ? sql`ORDER BY username ASC`
      : sql`ORDER BY recording_count DESC, username ASC`;

    const result = await db.execute(sql`
      WITH performer_stats AS (
        SELECT
          username,
          gender,
          COUNT(*)::int AS recording_count,
          MAX(timestamp) AS latest_timestamp
        FROM recordings_with_links
        WHERE links IS NOT NULL
        ${genderFilter}
        ${searchFilter}
        GROUP BY username, gender
      ),
      latest_recordings AS (
        SELECT DISTINCT ON (r.username)
          r.username,
          r.thumbnail_url,
          r.sprite_url
        FROM recordings_with_links r
        WHERE r.links IS NOT NULL
        ORDER BY r.username,
          CASE WHEN r.thumbnail_url IS NOT NULL THEN 0 ELSE 1 END,
          r.timestamp DESC
      )
      SELECT
        ps.username,
        ps.recording_count,
        ps.gender,
        ps.latest_timestamp,
        lr.thumbnail_url AS latest_thumbnail,
        lr.sprite_url
      FROM performer_stats ps
      LEFT JOIN latest_recordings lr ON lr.username = ps.username
      ${sortClause}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `);

    const performers = result.rows.map((r: any) => ({
      username: r.username as string,
      recording_count: r.recording_count as number,
      latest_thumbnail: (r.latest_thumbnail || r.sprite_url) as string | null,
      sprite_url: r.sprite_url as string | null,
      gender: r.gender as string | null,
      latest_timestamp: r.latest_timestamp as string | null,
    }));

    const totalPages = Math.ceil(totalPerformers / limit) || 1;

    res.json({ performers, total: totalPerformers, page, limit, totalPages });
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

    const SELECT_COLS = "id,channel_id,username,filename,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,embed_url,preview_url,instance_id,created_at,updated_at";
    const { data: validRecordings, error } = await supabase
      .from("recordings_with_links")
      .select(SELECT_COLS)
      .not("links", "is", "null")
      .eq("username", username)
      .order("timestamp", { ascending: false });

    if (error) {
      req.log.error({ err: error, username }, "Supabase error fetching performer");
      res.status(500).json({ error: "Failed to fetch performer" });
      return;
    }

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
