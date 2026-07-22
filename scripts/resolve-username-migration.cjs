/**
 * Database migration: Fix resolve_username RPC + add recording notification trigger.
 *
 * Run with:
 *   node scripts/resolve-username-migration.cjs
 *
 * Requires DATABASE_URL environment variable (Supabase connection string).
 */
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is required");
  console.error("   Get it from: Supabase Dashboard → Project Settings → Database → Connection string");
  process.exit(1);
}

async function run() {
  console.log("🔌 Connecting to Supabase database...\n");

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    // Test connection
    const ping = await pool.query("SELECT NOW() AS now");
    console.log(`✅ Connected (server time: ${ping.rows[0].now})\n`);

    // Read the full SQL migration file
    const sqlPath = path.resolve(__dirname, "resolve-username-migration.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    console.log("📦 Running migration...\n");

    // Execute the entire SQL migration as a single batch.
    // pg Pool's query() natively handles multi-statement SQL strings.
    await pool.query(sql);

    console.log("✅ Migration executed successfully\n");

    // ── Verification ──
    const [funcRes, triggerRes, func2Res] = await Promise.all([
      pool.query(`SELECT proname FROM pg_proc WHERE proname = 'resolve_username' AND pronamespace = 'public'::regnamespace`),
      pool.query(`SELECT trigger_name FROM information_schema.triggers WHERE trigger_name = 'trigger_notify_requesters_on_upload'`),
      pool.query(`SELECT proname FROM pg_proc WHERE proname = 'notify_requesters_on_upload' AND pronamespace = 'public'::regnamespace`),
    ]);

    console.log(funcRes.rows.length > 0
      ? "  ✓ resolve_username() function exists"
      : "  ✗ resolve_username() NOT found");

    console.log(triggerRes.rows.length > 0
      ? "  ✓ trigger_notify_requesters_on_upload exists"
      : "  ✗ trigger_notify_requesters_on_upload NOT found");

    console.log(func2Res.rows.length > 0
      ? "  ✓ notify_requesters_on_upload() function exists"
      : "  ✗ notify_requesters_on_upload() NOT found");

    console.log("\n🎉 Migration complete! Users can now log in with their username.");
    console.log("   New recordings will automatically notify matching requesters.");

  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
