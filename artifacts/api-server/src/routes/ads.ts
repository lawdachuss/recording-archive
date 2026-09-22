import { Router } from "express";

/**
 * ads.ts — Adsterra Publisher API proxy.
 *
 * Wraps the Adsterra Publisher API (https://api3.adsterratools.com/publisher)
 * server-side so the API token (ADSTERRA_API_KEY) never reaches the browser.
 * Used for monitoring placements/smartlinks and their direct URLs.
 */

const API_BASE = "https://api3.adsterratools.com/publisher";

interface Placement {
  id: number;
  domain_id: number;
  title: string;
  alias: string;
  direct_url?: string;
}

const router = Router();

router.get("/ads/status", async (_req, res) => {
  const token = process.env.ADSTERRA_API_KEY;
  if (!token) {
    res.status(503).json({ error: "Adsterra API not configured (ADSTERRA_API_KEY missing)" });
    return;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-API-Key": token,
  };

  try {
    const [domainsRes, placementsRes] = await Promise.all([
      fetch(`${API_BASE}/domains.json`, { headers }),
      fetch(`${API_BASE}/placements.json`, { headers }),
    ]);

    if (!domainsRes.ok || !placementsRes.ok) {
      res.status(502).json({ error: `Adsterra API responded ${domainsRes.status}/${placementsRes.status}` });
      return;
    }

    const domains = (await domainsRes.json()) as { items: Array<{ id: number; title: string }> };
    const placements = (await placementsRes.json()) as { items: Placement[] };

    const domainMap = new Map(domains.items.map((d) => [d.id, d.title]));

    res.json({
      tokenConfigured: true,
      domains: domains.items,
      placements: placements.items.map((p) => ({
        id: p.id,
        domain: domainMap.get(p.domain_id) ?? `#${p.domain_id}`,
        title: p.title,
        direct_url: p.direct_url ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "failed to reach Adsterra API", detail: message });
  }
});

export default router;