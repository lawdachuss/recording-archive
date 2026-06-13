const dns = require("dns");
dns.setDefaultResultOrder("ipv6first");

const pg = require("C:\\Users\\basud\\OneDrive\\Desktop\\frontend\\node_modules\\.pnpm\\pg@8.20.0\\node_modules\\pg");
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://postgres:8tondElcK9iSmTxx@db.alcwxntejivcqlurudts.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function run() {
  console.log("Adding links column...");
  await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS links jsonb DEFAULT '{}'::jsonb`);
  console.log("Column 'links' added successfully!");

  // Verify
  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recordings' ORDER BY ordinal_position`
  );
  console.log("Recordings columns:", cols.rows.map(c => c.column_name).join(", "));

  await pool.end();
}

run().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
