import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://postgres:8tondElcK9iSmTxx@db.alcwxntejivcqlurudts.supabase.co:5432/postgres",
});

async function run() {
  // Add embed_urls array column
  await pool.query(`ALTER TABLE recordings ADD COLUMN IF NOT EXISTS embed_urls text[] DEFAULT '{}'::text[]`);
  console.log("Column embed_urls added");

  // Backfill existing embed_url into embed_urls
  const { rowCount } = await pool.query(`
    UPDATE recordings 
    SET embed_urls = ARRAY[embed_url] 
    WHERE embed_url IS NOT NULL AND embed_url != '' 
    AND (embed_urls IS NULL OR coalesce(array_length(embed_urls, 1), 0) = 0)
  `);
  console.log(`Backfilled ${rowCount} recordings`);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
