/**
 * apply-migration.mjs — apply a SQL migration file to the self-hosted
 * Supabase Postgres using the `pg` driver (no psql needed on this machine).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/apply-migration.mjs [file]
 *
 * The connection string is read from env (DATABASE_URL or SUPABASE_DB_URL)
 * or the --url flag — it is never printed or logged. For self-hosted Supabase
 * this is typically:
 *   postgresql://supabase_admin:<password>@<host>:5432/postgres
 *
 * Default file: supabase/migrations/001_aggregate_rpcs.sql (relative to the
 * api-server package if not found relative to cwd).
 *
 * After applying, verifies the functions exist and reports row counts.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const urlFlagIdx = args.indexOf("--url");
const connectionUrl =
  (urlFlagIdx !== -1 ? args[urlFlagIdx + 1] : undefined) ??
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DB_URL;

if (!connectionUrl) {
  console.error("No connection string. Set DATABASE_URL (or pass --url).");
  process.exit(1);
}

const candidates = [
  args[0] && args[0] !== "--url" ? args[0] : null,
  "supabase/migrations/001_aggregate_rpcs.sql",
  path.join("artifacts", "api-server", "supabase", "migrations", "001_aggregate_rpcs.sql"),
].filter(Boolean);

const file = candidates.find((c) => existsSync(c));
if (!file) {
  console.error(`Migration file not found. Looked in: ${candidates.join(", ")}`);
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

const client = new pg.Client({
  connectionString: connectionUrl,
  ssl: /sslmode=require|supabase\.(co|com)/.test(connectionUrl)
    ? { rejectUnauthorized: false }
    : undefined,
});

try {
  await client.connect();
  console.log(`Connected. Applying ${file} …`);
  await client.query(sql);
  console.log("Migration applied.");

  const { rows } = await client.query(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('get_tag_counts','get_site_stats')
      order by p.proname`,
  );
  console.log("Functions now in public schema:");
  for (const r of rows) console.log(`  - ${r.proname}(${r.args})`);

  // Smoke-test the functions (cheap on small datasets; RPCs are STABLE).
  try {
    const tags = await client.query("select * from get_tag_counts() limit 3");
    console.log(`get_tag_counts() OK — returning ${tags.rowCount} sample rows (limit 3)`);
    const stats = await client.query("select * from get_site_stats()");
    console.log("get_site_stats() OK —", stats.rows[0]);
  } catch (err) {
    console.warn("Function smoke test failed:", err.message);
  }

  console.log("Done. The API routes will pick the RPCs up automatically (cache TTLs apply).");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
