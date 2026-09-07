/**
 * apply-migration-http.mjs — apply a SQL migration to self-hosted Supabase
 * through the pg-meta endpoint (the same service Studio's SQL editor uses),
 * authenticated with the service-role key from the api-server .env.
 *
 * Usage:
 *   node scripts/apply-migration-http.mjs [file]
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from process env (load
 * artifacts/api-server/.env first). Never prints secrets. Sends the whole
 * file as one query so dollar-quoted function bodies survive intact, then
 * verifies the functions exist and smoke-tests them.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (source artifacts/api-server/.env).");
  process.exit(1);
}

const candidates = [
  process.argv[2],
  "supabase/migrations/001_aggregate_rpcs.sql",
  path.join("artifacts", "api-server", "supabase", "migrations", "001_aggregate_rpcs.sql"),
].filter(Boolean);

const file = candidates.find((c) => existsSync(c));
if (!file) {
  console.error(`Migration file not found. Looked in: ${candidates.join(", ")}`);
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

async function pgQuery(query) {
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

try {
  console.log(`Applying ${file} (${sql.length} bytes) via /pg/query …`);
  const result = await pgQuery(sql);
  console.log("Migration response:", JSON.stringify(result).slice(0, 300));

  const check = await pgQuery(
    `select n.nspname, p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('get_tag_counts','get_site_stats')
      order by p.proname`,
  );
  console.log("Functions now in public schema:", JSON.stringify(check));

  const tags = await pgQuery("select * from public.get_tag_counts() limit 3");
  console.log("get_tag_counts() smoke test (3 rows):", JSON.stringify(tags));

  const stats = await pgQuery("select * from public.get_site_stats()");
  console.log("get_site_stats() smoke test:", JSON.stringify(stats));

  console.log("Done. API routes will use the RPCs automatically.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
}