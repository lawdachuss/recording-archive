// Does the ANON key (what the real browser uses) actually read the ad tables?
// If this fails, AdsContext falls back to "file" mode, popunder.txt is EMPTY,
// and the popunder can never fire.
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const u = env.VITE_SUPABASE_URL;
const k = env.VITE_SUPABASE_ANON_KEY;
console.log("VITE_SUPABASE_URL set:", Boolean(u), "| VITE_SUPABASE_ANON_KEY set:", Boolean(k));
console.log("anon key == service key:", k === env.SUPABASE_SERVICE_ROLE_KEY);

const H = { apikey: k, Authorization: `Bearer ${k}` };

const a = await fetch(`${u}/rest/v1/ad_creatives?select=slot,enabled,kind&slot=eq.popunder`, { headers: H });
console.log("\nANON ad_creatives(popunder):", a.status, a.statusText);
console.log("  body:", (await a.text()).slice(0, 300));

const b = await fetch(`${u}/rest/v1/ad_settings?select=config&id=eq.1`, { headers: H });
console.log("\nANON ad_settings:", b.status, b.statusText);
console.log("  body:", (await b.text()).slice(0, 300));

const c = await fetch(`${u}/rest/v1/ad_creatives?select=count`, {
  headers: { ...H, Prefer: "count=exact", Range: "0-0" },
});
console.log("\nANON ad_creatives count status:", c.status, "| content-range:", c.headers.get("content-range"));
