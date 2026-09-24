import { Router, type Request, type Response } from "express";

/**
 * StripCash (Stripchat's affiliate program) smartlink config — PUBLIC read,
 * fetched once per page load by the frontend's AdsContext (same contract as
 * /api/premium/config).
 *
 * The affiliate API key (STRIPCASH_API_KEY) lives ONLY in server env — it is
 * never bundled into the client. What crosses the wire is the tracked
 * smartlink `https://go.stripchat.com/?userId=<key>&p1=<subid>` — StripCash's
 * own affiliate link format, which is client-visible by design (the redirect
 * carries the userId anyway, exactly like every CrakRevenue offer URL).
 *
 * The link feeds the reward-CTA direct-link pool on the frontend, and opens
 * as the popunder ONLY when the popunder slot itself is empty (it never
 * displaces a configured popunder creative — see pickPopunderMarkup). Both
 * are gated by the admin "StripCash" zone switch
 * (ad_settings.placements.stripcash).
 *
 * `verified` probes the link (redirect:manual → any 3xx + Location) behind a
 * 10-minute cache so the admin panel can show a live/unlive status without
 * hammering their edge.
 */
const router = Router();

const URL_RE = /^https?:\/\/\S+$/i;
/** StripCash API keys are 40-hex (SHA-1 shaped). */
const HEX_KEY_RE = /^[a-f0-9]{40}$/i;
const VERIFY_TTL_MS = 10 * 60_000;

/**
 * Server-side smartlink builder. `STRIPCASH_SMARTLINK` (optional) overrides
 * with a hand-made dashboard Easy Link / smartlink; otherwise the tracked
 * link is derived from the API key. Invalid values → null (unconfigured).
 */
export function buildSmartlink(): string | null {
  const override = process.env.STRIPCASH_SMARTLINK?.trim();
  if (override) {
    return URL_RE.test(override) && !/\s/.test(override) ? override : null;
  }
  const key = process.env.STRIPCASH_API_KEY?.trim();
  if (!key || !HEX_KEY_RE.test(key)) return null;
  return `https://go.stripchat.com/?userId=${key}&p1=vault`;
}

interface VerifyCache {
  link: string;
  at: number;
  ok: boolean;
}
let verifyCache: VerifyCache | null = null;

/** Does the smartlink still resolve? Redirect-following is off — StripCash's edge answers a bare 302/307. Cached 10 min per link. */
export async function verifySmartlink(link: string, now = Date.now()): Promise<boolean> {
  if (verifyCache && verifyCache.link === link && now - verifyCache.at < VERIFY_TTL_MS) {
    return verifyCache.ok;
  }
  let ok = false;
  try {
    const res = await fetch(link, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000),
    });
    ok = res.status >= 300 && res.status < 400 && Boolean(res.headers.get("location"));
  } catch {
    ok = false;
  }
  verifyCache = { link, at: now, ok };
  return ok;
}

router.get("/ads/stripcash", async (_req: Request, res: Response) => {
  const smartlink = buildSmartlink();
  if (!smartlink) {
    res.json({ configured: false, verified: false, smartlink: null });
    return;
  }
  const verified = await verifySmartlink(smartlink);
  res.json({ configured: true, verified, smartlink });
});

export default router;
