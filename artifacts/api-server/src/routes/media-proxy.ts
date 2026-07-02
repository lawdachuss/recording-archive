import { Router } from "express";

// Only proxy requests to these allowed domains
const ALLOWED_HOSTS = [
  "pixeldrain.com",
  "www.pixeldrain.com",
  "img2.pixhost.to",
  "pixhost.to",
  "www.pixhost.to",
  "files.catbox.moe",
  "catbox.moe",
  "lobfile.com",
  "www.lobfile.com",
  "i.ibb.co",
];

// Pixeldrain API key — set this env var to authenticate API requests so the
// proxy can bypass hotlinking restrictions (Cloudflare 403 without auth).
// Get your key from https://pixeldrain.com/user/api_keys
const PIXELDRAIN_API_KEY = process.env.PIXELDRAIN_API_KEY ?? "";

const router = Router();

router.get("/media", async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) {
    res.status(400).json({ error: "Missing 'url' query parameter" });
    return;
  }

  let urlStr: string;
  try {
    urlStr = decodeURIComponent(rawUrl);
    new URL(urlStr); // validate
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const parsed = new URL(urlStr);
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(403).json({ error: "Domain not allowed" });
    return;
  }

  try {
    // Build upstream request headers — use a real browser UA to avoid being
    // blocked by CDNs / hotlinking protections.
    const upstreamHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // If the upstream is pixeldrain.com, attach the API key via HTTP Basic
    // auth so we can bypass hotlinking restrictions.
    if (PIXELDRAIN_API_KEY && parsed.hostname.includes("pixeldrain.com")) {
      const encoded = Buffer.from(":" + PIXELDRAIN_API_KEY).toString("base64");
      upstreamHeaders["Authorization"] = "Basic " + encoded;
    }

    const rangeHeader = req.headers["range"];
    if (rangeHeader) {
      upstreamHeaders["Range"] = rangeHeader;
    }

    const response = await fetch(urlStr, {
      headers: upstreamHeaders,
    });

    if (!response.ok && response.status !== 206) {
      req.log.error({ url: urlStr, status: response.status }, "Media proxy upstream error");
      res.status(502).json({ error: "Upstream fetch failed" });
      return;
    }

    // Forward content-type from upstream
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    // Forward range-related headers for partial content support
    const contentLength = response.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const contentRange = response.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    const acceptRanges = response.headers.get("accept-ranges");
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);

    // Forward the correct status for partial content
    if (response.status === 206) {
      res.status(206);
    }

    // Cache aggressively — previews/sprite sheets are immutable
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");

    // Stream the response body
    if (response.body) {
      // Use ReadableStream to pipe through
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(value);
        }
      };
      pump().catch((err) => {
        req.log.error({ err }, "Media proxy stream error");
        if (!res.headersSent) res.status(500).end();
      });
    } else {
      const text = await response.text();
      res.send(text);
    }
  } catch (err) {
    req.log.error({ err }, "Media proxy fetch error");
    if (!res.headersSent) res.status(502).json({ error: "Upstream fetch failed" });
  }
});

export default router;
