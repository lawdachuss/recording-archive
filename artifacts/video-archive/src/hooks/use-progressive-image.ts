/**
 * use-progressive-image.ts — load an image with real-time download progress.
 *
 * The card's hover media (sprite sheets / previews) used to show an
 * indeterminate shimmer + spinner while it loaded. This hook replaces that
 * with honest, real-time progress:
 *
 *   1. IDB blob cache hit  → instant blob URL, no network, no progress bar.
 *   2. Cache miss          → stream the fetch and report byte progress
 *                            (loaded / content-length) as it downloads.
 *   3. Streaming impossible → fall back to the original URL and let the
 *                            consumer's native <img> loading + mirror/wsrv
 *                            fallback chain handle it (no progress bar).
 *
 * The streamed bytes are turned into a blob URL so the display element never
 * issues a second network request, and the IDB cache is warmed afterwards
 * (cheap — the response is already in the browser HTTP cache).
 */

import { useEffect, useRef, useState } from "react";
import { getCachedBlobUrl, releaseBlobUrl, cacheImage } from "@/lib/image-cache";

// First-byte timeout: a host that accepts the connection but never sends
// anything (catbox-style stalls) must fall back to the native <img> path
// instead of leaving the bar at 0 forever.
const FIRST_BYTE_TIMEOUT_MS = 12_000;
// Stall watchdog: reset on every chunk. If the stream stops delivering bytes
// mid-download (server hang), abort and fall back so the mirror chain engages.
const STALL_TIMEOUT_MS = 20_000;

/**
 * Validate the first 12 bytes of a response body against known image format
 * magic numbers. Catches corrupt / HTML-error-body responses that arrive with
 * a 200 + image content-type and would otherwise be displayed as a broken
 * blob URL (the proxy's "Image unavailable" placeholder).
 */
function isValidImageMagic(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const gif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
  const webp =
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  const avif =
    head.length >= 12 &&
    head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x00 && head[3] === 0x18 &&
    head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70 &&
    head[8] === 0x61 && head[9] === 0x76 && head[10] === 0x69 && head[11] === 0x66;
  return jpeg || png || gif || webp || avif;
}

export interface ProgressiveImageResult {
  /**
   * URL to display: a blob: URL once bytes are available, or the original
   * URL when streaming isn't possible (cross-origin without CORS, failure).
   * null while the IDB check is still resolving.
   */
  src: string | null;
  /**
   * Real download progress 0-100, or null when not measurable / already
   * instant. Cap at 99 while loading; 100 once complete.
   */
  progress: number | null;
}

export function useProgressiveImage(
  url: string | null | undefined,
  enabled: boolean,
): ProgressiveImageResult {
  const [src, setSrc] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const blobRef = useRef<string | null>(null);
  // Original URL currently held as a ref-counted IDB blob URL (see
  // getCachedBlobUrl — must release with the ORIGINAL url).
  const idbUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Tear down the previous load (hover ended / url changed).
    abortRef.current?.abort();
    abortRef.current = null;
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    if (idbUrlRef.current) {
      releaseBlobUrl(idbUrlRef.current);
      idbUrlRef.current = null;
    }
    setSrc(null);
    setProgress(null);

    if (!url || !enabled) return;

    let cancelled = false;

    // 1) Already in the IDB blob cache → instant, zero network.
    getCachedBlobUrl(url).then((blobUrl) => {
      if (cancelled) {
        if (blobUrl) releaseBlobUrl(url);
        return;
      }
      if (blobUrl) {
        idbUrlRef.current = url;
        setSrc(blobUrl);
        setProgress(null); // instant — nothing to show progress for
        return;
      }

      // 2) Not cached — stream the fetch for real progress. Works for
      //    same-origin /api/media (pixhost) and cross-origin hosts that
      //    send CORS headers (catbox). On any failure we fall back to the
      //    original URL so the consumer's native loading + fallback chain
      //    (mirrors, wsrv → direct) engages as before.
      const controller = new AbortController();
      abortRef.current = controller;

      // Timeout management: the first arm gives the connection FIRST_BYTE
      // budget (connect + headers + first data); STALL_TIMEOUT_MS is re-armed
      // on every chunk so a slow-but-progressing download is never cut short,
      // while a connection that stops delivering bytes is abandoned so the
      // fallback chain can engage.
      let stallTimer: number | null = null;
      const armStallTimer = (ms: number) => {
        if (stallTimer !== null) window.clearTimeout(stallTimer);
        stallTimer = window.setTimeout(() => controller.abort(), ms);
      };
      armStallTimer(FIRST_BYTE_TIMEOUT_MS);
      const clearTimers = () => {
        if (stallTimer !== null) {
          window.clearTimeout(stallTimer);
          stallTimer = null;
        }
      };

      (async () => {
        try {
          const res = await fetch(url, {
            cache: "force-cache",
            credentials: url.startsWith("/") ? "same-origin" : "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          });
          if (!res.ok || cancelled) throw new Error(`progressive fetch ${res.status}`);
          const contentType = res.headers.get("content-type") || "";
          // Never surface the proxy/SW "Image unavailable" placeholder —
          // treat it as a failure so the mirror fallback chain can engage.
          if (contentType.includes("image/svg+xml")) throw new Error("placeholder body");

          const total = Number(res.headers.get("content-length")) || 0;
          let blob: Blob;
          if (res.body && total > 0) {
            const reader = res.body.getReader();
            const chunks: Uint8Array[] = [];
            let loaded = 0;
            let lastPct = -1;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                loaded += value.byteLength;
                armStallTimer(STALL_TIMEOUT_MS); // bytes flowing — restart the stall watchdog
              }
              const pct = Math.min(99, Math.floor((loaded / total) * 100));
              if (pct !== lastPct) {
                lastPct = pct;
                if (!cancelled) setProgress(pct);
              }
            }
            // Concatenate into one buffer so the Blob part is a plain
            // ArrayBuffer-backed view (TS-safe across lib versions).
            const full = new Uint8Array(loaded);
            let offset = 0;
            for (const c of chunks) {
              full.set(c, offset);
              offset += c.byteLength;
            }
            blob = new Blob([full], { type: contentType || "image/*" });
          } else {
            // No stream / no content-length — still deliver, just no progress.
            blob = await res.blob();
          }
          if (cancelled) return;
          if (blob.size === 0) throw new Error("empty body");

          // Validate magic bytes so a corrupt / non-image body (HTML error
          // page, proxy placeholder) is never surfaced as a blob URL.
          const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
          if (!isValidImageMagic(head)) throw new Error("non-image response body");

          const objectUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          clearTimers();
          blobRef.current = objectUrl;
          setSrc(objectUrl);
          setProgress(100);
          // Warm IDB for repeat visits — cheap: response is in the HTTP cache.
          cacheImage(url, 2).catch(() => {});
        } catch {
          clearTimers();
          if (!cancelled) {
            // Fall back to the original URL — the consumer's <img>/fallback
            // chain takes over from here.
            setSrc(url);
            setProgress(null);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      if (idbUrlRef.current) {
        releaseBlobUrl(idbUrlRef.current);
        idbUrlRef.current = null;
      }
      setSrc(null);
      setProgress(null);
    };
  }, [url, enabled]);

  return { src, progress };
}