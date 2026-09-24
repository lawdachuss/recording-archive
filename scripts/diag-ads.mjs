// Diagnostic: what does the ad system ACTUALLY have configured?
// Uses plain PostgREST over fetch — no package deps.
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) return { error: `${res.status} ${await res.text()}` };
  return { data: await res.json() };
}

const creatives = await rest("ad_creatives?select=*");
if (creatives.error) console.log("ad_creatives ERROR:", creatives.error);
else {
  console.log(`ad_creatives: ${creatives.data.length} rows`);
  for (const r of creatives.data) {
    const head = String(r.content).replace(/\s+/g, " ").slice(0, 120);
    console.log(`  [${r.slot}] kind=${r.kind} enabled=${r.enabled} sort=${r.sort_order} :: ${head}`);
  }
  const pu = creatives.data.filter((r) => r.slot === "popunder");
  console.log(`\nPOPUNDER rows: ${pu.length} (enabled: ${pu.filter((r) => r.enabled).length})`);
}

const settings = await rest("ad_settings?select=config&id=eq.1");
if (settings.error) console.log("\nad_settings ERROR:", settings.error);
else console.log("\nad_settings.config =", JSON.stringify(settings.data?.[0]?.config ?? {}, null, 2));
