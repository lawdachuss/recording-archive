const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://postgres:8tondElcK9iSmTxx@db.alcwxntejivcqlurudts.supabase.co:5432/postgres",
});

async function run() {
  const tables = await pool.query(
    `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log("=== TABLES ===");
  tables.rows.forEach(t => console.log(`  ${t.table_name} (${t.table_type})`));

  for (const t of tables.rows) {
    const cols = await pool.query(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [t.table_name]
    );
    console.log(`\n=== ${t.table_name} columns ===`);
    cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type} (${c.udt_name})`));

    const count = await pool.query(`SELECT COUNT(*) FROM "${t.table_name}"`);
    console.log(`  Row count: ${count.rows[0].count}`);

    if (parseInt(count.rows[0].count) > 0) {
      const sample = await pool.query(`SELECT * FROM "${t.table_name}" LIMIT 3`);
      console.log(`  Sample:`, JSON.stringify(sample.rows, null, 2));
    }
  }

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
