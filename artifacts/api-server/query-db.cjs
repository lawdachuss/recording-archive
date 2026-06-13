const { Pool } = require("C:\\Users\\basud\\OneDrive\\Desktop\\frontend\\node_modules\\.pnpm\\pg@8.20.0\\node_modules\\pg");

const pool = new Pool({
  connectionString: "postgresql://postgres:8tondElcK9iSmTxx@db.alcwxntejivcqlurudts.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

async function run() {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log("=== TABLES ===", tables.rows.map(r => r.table_name).join(", "));

  for (const r of tables.rows) {
    const name = r.table_name;
    const cols = await pool.query(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [name]
    );
    console.log(`\n--- ${name} ---`);
    cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type} (${c.udt_name})`));

    const cnt = await pool.query(`SELECT COUNT(*) FROM "${name}"`);
    console.log(`  count: ${cnt.rows[0].count}`);

    if (parseInt(cnt.rows[0].count) > 0) {
      const s = await pool.query(`SELECT * FROM "${name}" LIMIT 2`);
      s.rows.forEach((row, i) => console.log(`  [${i}] ${JSON.stringify(row)}`));
    }
  }

  await pool.end();
}

run().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
