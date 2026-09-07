import { Router } from "express";
import { GetPerformerParams } from "@workspace/api-zod";
import { supabase, fetchAll } from "../lib/supabase.js";
import { cache } from "../middleware/cache.js";
import { logger } from "../lib/logger.js";

const COOKIES = process.env.COOKIES ?? "";
const CB_AFFILIATE = process.env.CHATURBATE_AFFILIATE_CODE ?? "";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Googlebot UA bypasses Cloudflare for Chaturbate (used only for API calls)
const CB_UA = "Googlebot/2.1 (+http://www.google.com/bot.html)";

// ─── Chaturbate API check ──────────────────────────────────────────────────
// Uses the internal /get_edge_hls_url_ajax/ endpoint (same as yt-dlp).
// Returns { exists, is_live, room_status }.
// No cookies needed -- works from serverless IPs.
async function checkChaturbateApi(
  username: string,
): Promise<{ exists: boolean; is_live: boolean; room_status: string } | null> {
  try {
    const res = await fetch("https://chaturbate.com/get_edge_hls_url_ajax/", {
      method: "POST",
      headers: {
        "User-Agent": CB_UA,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `room_slug=${encodeURIComponent(username)}`,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      room_status?: string;
    };
    return {
      exists: !!data.success,
      is_live: data.room_status === "public" || data.room_status === "group_show" || data.room_status === "private",
      room_status: data.room_status ?? "unknown",
    };
  } catch {
    return null;
  }
}

// ─── Stripchat HTML scraping ───────────────────────────────────────────────
// Stripchat pages are massive React SPAs (2-5 MB inline JS/state).
// Stream the response and stop after MAX_STRIPCHAT_BYTES.
const MAX_STRIPCHAT_BYTES = 400_000; // ~400 KB -- isOnline JSON is at ~294 KB

async function fetchStripchatPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: COOKIES,
      },
    });
    if (!res.ok) return null;
    if (!res.body) return res.text();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let totalBytes = 0;

    while (totalBytes < MAX_STRIPCHAT_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      accumulated += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();
    return accumulated;
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, propertyOrName: string): string | null {
  const propRegex = new RegExp(
    `<meta\\s+property=["']${propertyOrName}["']\\s+content=["']([^"']*)["']`,
    "i",
  );
  let match = html.match(propRegex);
  if (match) return match[1];
  const nameRegex = new RegExp(
    `<meta\\s+name=["']${propertyOrName}["']\\s+content=["']([^"']*)["']`,
    "i",
  );
  match = html.match(nameRegex);
  if (match) return match[1];
  const revRegex = new RegExp(
    `<meta\\s+content=["']([^"']*)["']\\s+property=["']${propertyOrName}["']`,
    "i",
  );
  match = html.match(revRegex);
  return match ? match[1] : null;
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

function performerExistsOnStripchat(html: string, username: string): boolean {
  const bodyLower = html.toLowerCase();
  const usernameLower = username.toLowerCase();

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
  const canonicalLink = (
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
    )
  )?.[1];
  if (canonicalLink) {
    const normalized = canonicalLink.replace(/\/+$/, "").toLowerCase();
    if (expectedUrls.some((u) => normalized === u)) return true;
  }

  // 3. Check data attributes
  if (bodyLower.includes(`data-model-username="${usernameLower}"`))
    return true;
  if (bodyLower.includes(`data-username="${usernameLower}"`)) return true;
  if (bodyLower.includes(`data-profile="${usernameLower}"`)) return true;

  // 4. Check for profile links pointing to this exact username
  const profileLinkRegex = new RegExp(
    `href=["']https://stripchat\\.com/${usernameLower}(?:/|"|')`,
    "i",
  );
  if (profileLinkRegex.test(html)) return true;

  // 5. Check twitter:site with matching username + performer-specific og:image
  const twitterSite = extractMetaContent(html, "twitter:site");
  if (twitterSite && twitterSite.toLowerCase().includes(usernameLower)) {
    const ogImage = extractMetaContent(html, "og:image");
    if (ogImage && !ogImage.includes("default") && !ogImage.includes("logo"))
      return true;
  }

  return false;
}

const router = Router();

// ─── Mirror enrichment ─────────────────────────────────────────────────────
const MIRROR_COLS = "id,thumbnail_mirrors,sprite_mirrors,preview_mirrors";

async function fetchMirrors(ids: string[]): Promise<Map<string, any>> {
  const mirrorMap = new Map();
  if (ids.length === 0) return mirrorMap;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data } = await supabase.from("recordings").select(MIRROR_COLS).in("id", chunk);
    if (data) for (const row of data) mirrorMap.set(row.id, row);
  }
  return mirrorMap;
}

async function enrichWithMirrors(rows: any[]): Promise<any[]> {
  const ids = rows.map(r => r.id).filter(Boolean);
  const mirrorMap = await fetchMirrors(ids);
  return rows.map(r => {
    const mirrors = mirrorMap.get(r.id);
    if (!mirrors) return r;
    return { ...r, ...mirrors };
  });
}

router.get(
  "/performers/lookup",
  cache({ ttlSeconds: 120, staleSeconds: 300, tags: ["performers", "search"] }),
  async (req, res) => {
    try {
      const platform = (req.query.platform as string)?.toLowerCase();
      const username = (req.query.username as string)?.toLowerCase().trim();

      if (!platform || !username) {
        res
          .status(400)
          .json({ error: "platform and username are required" });
        return;
      }
      if (!["chaturbate", "stripchat"].includes(platform)) {
        res.status(400).json({
          error: 'platform must be "chaturbate" or "stripchat"',
        });
        return;
      }

      const profileUrl =
        platform === "chaturbate"
          ? `https://chaturbate.com/${username}/${CB_AFFILIATE ? `?campaign=${CB_AFFILIATE}` : ''}`
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
          .select(
            "thumbnail_url, sprite_url, preview_url, timestamp, username",
          )
          .eq("username", username)
          .not("links", "is", "null")
          .order("timestamp", { ascending: false })
          .limit(50);

        if (archiveData && archiveData.length > 0) {
          result.in_archive = true;
          result.archive_recording_count = archiveData.length;
          result.archive_last_recording = archiveData[0].timestamp;
          result.archive_thumbnail =
            archiveData[0].thumbnail_url ||
            archiveData[0].sprite_url ||
            archiveData[0].preview_url ||
            null;
        }
      } catch {
        // Archive check failed, continue with platform check
      }

      // 2. Platform-specific existence check
      if (platform === "chaturbate") {
        // Use Chaturbate's internal JSON API (no cookies needed)
        const apiResult = await checkChaturbateApi(username);
        if (apiResult) {
          result.exists = apiResult.exists;
          result.is_online = apiResult.is_live;
          if (!apiResult.exists && result.in_archive) {
            result.exists = true;
            result.platform_check_failed = true;
          }
          res.json(result);
          return;
        }
        // API failed (Chaturbate blocks Vercel IPs via Cloudflare).
        // If the performer is in our archive, we know they exist.
        // Otherwise set platform_check_failed so the frontend can show a
        // helpful message instead of "Performer not found".
        result.platform_check_failed = true;
        if (result.in_archive) {
          result.exists = true;
        }
        res.json(result);
        return;
      }

      // Stripchat: scrape the HTML page
      const html = await fetchStripchatPage(profileUrl);
      if (!html) {
        if (result.in_archive) {
          result.exists = true;
          result.platform_check_failed = true;
        }
        res.json(result);
        return;
      }

      if (performerExistsOnStripchat(html, username)) {
        result.exists = true;
      } else {
        // No positive signals -- check <title> for not-found patterns
        const titleMatch = html.match(
          /<title[^>]*>([^<]*)<\/title>/i,
        );
        const title = titleMatch ? titleMatch[1].toLowerCase() : "";
        const notFoundTitles = [
          "page not found",
          "not found",
          "404",
          "error",
        ];
        const isNotFound = notFoundTitles.some((p) => title.includes(p));

        if (isNotFound) {
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

        result.exists = false;
        res.json(result);
        return;
      }

      // Parse Stripchat performer details from HTML
      const bodyLower = html.toLowerCase();
      result.display_name =
        extractMetaContent(html, "og:title") || username;
      result.avatar_url =
        extractMetaContent(html, "og:image") ?? undefined;

      // Parse online status from __PRELOADED_STATE__ JSON (byte ~294K)
      const isOnlineMatch = html.match(/"isOnline":(true|false)/i);
      if (isOnlineMatch) {
        result.is_online = isOnlineMatch[1] === "true";
      } else {
        // Fallback: text-based detection
        if (
          bodyLower.includes("is online") ||
          bodyLower.includes("online now") ||
          bodyLower.includes("live now")
        ) {
          result.is_online = true;
        } else {
          result.is_online = false;
          const lastSeenMatch = html.match(
            /(?:last\s+(?:online|seen|live)|offline)\s*[:]?\s*([^<]+)/i,
          );
          if (lastSeenMatch) {
            result.last_seen = lastSeenMatch[1].trim();
          }
        }
      }

      // Parse isLive from JSON for live streaming status
      const isLiveMatch = html.match(/"isLive":(true|false)/i);
      if (isLiveMatch && isLiveMatch[1] === "true") {
        result.is_online = true; // isLive overrides isOnline
      }

      // Parse viewer count from JSON state
      if (result.is_online) {
        const viewerMatch = html.match(
          /(\d[\d,]*)\s*(?:viewers?|watching)/i,
        );
        if (viewerMatch) {
          result.viewer_count = parseInt(
            viewerMatch[1].replace(/,/g, ""),
            10,
          );
        }
      }

      const ogDesc = extractMetaContent(html, "og:description");
      if (ogDesc) {
        result.room_title = ogDesc;
      }

      const followerMatch = html.match(
        /(\d[\d,.]*[kKmM]?)\s*(?:followers?|fans)/i,
      );
      if (followerMatch) {
        result.follower_count = parseCount(followerMatch[1]);
      }

      res.json(result);
    } catch (err) {
      req.log.error({ err }, "GET /performers/lookup error");
      res.status(500).json({ error: "Lookup failed" });
    }
  },
);

// ─── Performer list (archive stats per performer) ─────────────────────────
// PostgREST can't express COUNT(DISTINCT)/DISTINCT ON, so aggregate the view
// rows in JS. Result is cached for 10 minutes.
//
// Thumbnail host preference: pixhost-hosted thumbnails are served to the
// browser through our own /api/media proxy (reachable everywhere the site
// is), while catbox thumbnails load DIRECTLY from the browser and are blocked/
// unreliable on many networks. So for the card image we prefer the newest
// pixhost thumbnail; the newest thumbnail of any host is the fallback.
interface PerformerAgg {
  username: string;
  recording_count: number;
  gender: string | null;
  latest_timestamp: string | null;
  latest_thumbnail: string | null;
  sprite_url: string | null;
  // id of the row chosen for the card image — used to fetch its thumbnail
  // mirrors (same image on other hosts) for the fallback chain.
  pickId: string | null;
}

type RowLike = {
  id: string | null;
  username: string | null;
  gender: string | null;
  timestamp: string | null;
  thumbnail_url: string | null;
  sprite_url: string | null;
};

/** Hosts served through the always-reachable /api/media proxy. */
function isProxiedThumbHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "pixhost.to" || host.endsWith(".pixhost.to");
  } catch {
    return false;
  }
}

/** Newest of `cur` and `candidate` (by ISO timestamp; null timestamps lose). */
function newerRow(cur: RowLike | null, candidate: RowLike): RowLike {
  if (!cur) return candidate;
  if (!candidate.timestamp) return cur;
  if (!cur.timestamp) return candidate;
  return candidate.timestamp > cur.timestamp ? candidate : cur;
}

async function fetchPerformers(): Promise<PerformerAgg[]> {
  const { data, error } = await fetchAll((start, end) =>
    supabase
      .from("recordings_with_links")
      .select("id,username,gender,timestamp,thumbnail_url,sprite_url")
      .not("links", "is", "null")
      .range(start, end),
  );
  if (error) throw error;

  const byName = new Map<
    string,
    {
      count: number;
      gender: string | null;
      latestTs: string | null;
      // Most recent row that has any thumbnail at all.
      thumbRow: RowLike | null;
      // Most recent row whose thumbnail is on a proxied (always-reachable) host.
      proxiedThumbRow: RowLike | null;
      // Most recent row overall (sprite_url fallback source).
      latestRow: RowLike | null;
    }
  >();

  for (const r of data ?? []) {
    if (!r.username) continue;
    const row: RowLike = r;
    let agg = byName.get(r.username);
    if (!agg) {
      agg = { count: 0, gender: null, latestTs: null, thumbRow: null, proxiedThumbRow: null, latestRow: null };
      byName.set(r.username, agg);
    }
    agg.count++;
    if (row.gender && !agg.gender) agg.gender = row.gender;
    if (row.timestamp && (!agg.latestTs || row.timestamp > agg.latestTs)) agg.latestTs = row.timestamp;
    if (row.thumbnail_url) {
      agg.thumbRow = newerRow(agg.thumbRow, row);
      if (isProxiedThumbHost(row.thumbnail_url)) {
        agg.proxiedThumbRow = newerRow(agg.proxiedThumbRow, row);
      }
    }
    agg.latestRow = newerRow(agg.latestRow, row);
  }

  const performers: PerformerAgg[] = [];
  for (const [username, agg] of byName) {
    // Card image: newest proxied (pixhost) thumbnail when one exists — it is
    // guaranteed to load through /api/media. Otherwise fall back to the most
    // recent thumbnail of any host, then to the newest row's sprite.
    const imgRow = agg.proxiedThumbRow ?? agg.thumbRow ?? agg.latestRow;
    performers.push({
      username,
      recording_count: agg.count,
      gender: agg.gender,
      latest_timestamp: agg.latestTs,
      latest_thumbnail: imgRow?.thumbnail_url ?? imgRow?.sprite_url ?? null,
      // Keep the hover sprite on the same (preferred, proxied) row when it has
      // one, so the avatar and its hover animation are both reachable.
      sprite_url: imgRow?.sprite_url ?? agg.latestRow?.sprite_url ?? null,
      pickId: imgRow?.id ?? null,
    });
  }
  return performers;
}

// ─── Mirror fallback chain for the card image ─────────────────────────────
// Mirrors store the SAME image on other hosts ({ Host: url }). Order mirrors
// so a card image keeps showing even when the primary host fails to load:
// pixhost mirrors first (served through our /api/media proxy — reachable
// everywhere the site is), then catbox (direct, unreliable on many networks),
// then the rest.
const MIRROR_HOST_PRIORITY = ["Pixhost", "Catbox", "ImgChest", "freeimage.host"];

function buildFallbackImages(
  primary: string | null | undefined,
  mirrors: Record<string, string> | null | undefined,
  sprite: string | null | undefined,
): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (u && /^https?:\/\//i.test(u) && !out.includes(u)) out.push(u);
  };
  push(primary);
  if (mirrors && typeof mirrors === "object") {
    for (const host of MIRROR_HOST_PRIORITY) push(mirrors[host]);
    for (const u of Object.values(mirrors)) push(u);
  }
  // Sprite is a different image — last resort so the card still has an image.
  push(sprite);
  return out;
}

router.get(
  "/performers",
  cache({
    ttlSeconds: 600,
    staleSeconds: 900,
    tags: ["performers", "recordings", "search"],
  }),
  async (req, res) => {
    try {
      const page = Math.max(
        1,
        parseInt(req.query.page as string) || 1,
      );
      const limit = Math.min(
        100,
        Math.max(1, parseInt(req.query.limit as string) || 24),
      );
      const search = (req.query.search as string) || "";
      const gender = (req.query.gender as string) || "";
      const sort = (req.query.sort as string) || "count";

      let performers = await fetchPerformers();

      if (gender) {
        performers = performers.filter((p) => p.gender === gender);
      }
      if (search) {
        const lower = search.toLowerCase();
        performers = performers.filter((p) => p.username.toLowerCase().includes(lower));
      }

      const totalPerformers = performers.length;

      if (sort === "name") {
        performers.sort((a, b) => a.username.localeCompare(b.username));
      } else {
        performers.sort(
          (a, b) =>
            b.recording_count - a.recording_count ||
            a.username.localeCompare(b.username),
        );
      }

      const offset = (page - 1) * limit;
      const pageRows = performers.slice(offset, offset + limit);
      const totalPages = Math.ceil(totalPerformers / limit) || 1;

      // Mirror fallbacks for the returned page: fetch thumbnail_mirrors of the
      // exact row each performer's card image came from (same image, other
      // hosts) so the card keeps showing an image when a host fails.
      const mirrorMap = await fetchMirrors(
        pageRows.map((p) => p.pickId).filter((id): id is string => !!id),
      );

      res.json({
        performers: pageRows.map((p) => {
          const primary = p.latest_thumbnail || p.sprite_url;
          const mirrors = p.pickId ? mirrorMap.get(p.pickId)?.thumbnail_mirrors ?? null : null;
          return {
            username: p.username,
            recording_count: p.recording_count,
            latest_thumbnail: primary,
            sprite_url: p.sprite_url,
            gender: p.gender,
            latest_timestamp: p.latest_timestamp,
            fallback_images: buildFallbackImages(primary, mirrors, p.sprite_url),
          };
        }),
        total: totalPerformers,
        page,
        limit,
        totalPages,
      });
    } catch (err) {
      req.log.error(
        { err },
        "GET /performers unexpected error",
      );
      res.status(500).json({ error: "Failed to fetch performers" });
    }
  },
);

router.get(
  "/performers/:username",
  cache({
    ttlSeconds: 900,
    staleSeconds: 1800,
    tags: ["performers", "recordings"],
  }),
  async (req, res) => {
    try {
      const parsed = GetPerformerParams.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid params" });
        return;
      }

      const { username } = parsed.data;

      const SELECT_COLS =
        "id,channel_id,username,filename,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,embed_url,preview_url,instance_id,created_at,updated_at";
      const { data: validRecordings, error } = await supabase
        .from("recordings_with_links")
        .select(SELECT_COLS)
        .not("links", "is", "null")
        .eq("username", username)
        .order("timestamp", { ascending: false });

      if (error) {
        req.log.error(
          { err: error, username },
          "Supabase error fetching performer",
        );
        res
          .status(500)
          .json({ error: "Failed to fetch performer" });
        return;
      }

      if (validRecordings.length === 0) {
        res.status(404).json({ error: "Performer not found" });
        return;
      }

      const enriched = await enrichWithMirrors(validRecordings);
      res.json({
        username,
        recording_count: enriched.length,
        gender: enriched[0].gender ?? null,
        recordings: enriched,
      });
    } catch (err) {
      req.log.error(
        { err, username: req.params.username },
        "GET /performers/:username unexpected error",
      );
      res
        .status(500)
        .json({ error: "Failed to fetch performer" });
    }
  },
);

export default router;
