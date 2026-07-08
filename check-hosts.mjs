import { Pool } from "pg";

const dbUrl = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: dbUrl.hostname,
  port: Number(dbUrl.port),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

const thumbs = await pool.query("SELECT thumbnail_url FROM recordings WHERE thumbnail_url IS NOT NULL AND thumbnail_url != '' LIMIT 20");
console.log("Sample thumbnail hosts:");
for (const r of thumbs.rows) {
  try { console.log(" ", new URL(r.thumbnail_url).hostname); } catch {}
}

const buckets = await pool.query("SELECT id, name, public FROM storage.buckets");
console.log("Storage buckets:", buckets.rows.map((r) => r.id));

// Also check what files exist in the recordings filename
const files = await pool.query("SELECT id, username, filename FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND (preview_url IS NOT NULL AND preview_url != '') LIMIT 10");
console.log("\nRecordings needing thumbnails:");
for (const r of files.rows) {
  console.log(`  ${r.id} | ${r.username} | ${r.filename}`);
}

await pool.end();
