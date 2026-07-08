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

const total = await pool.query("SELECT count(*) FROM recordings");
const noThumb = await pool.query("SELECT count(*) FROM recordings WHERE thumbnail_url IS NULL OR thumbnail_url = ''");
const noSprite = await pool.query("SELECT count(*) FROM recordings WHERE sprite_url IS NULL OR sprite_url = ''");
const noPreview = await pool.query("SELECT count(*) FROM recordings WHERE preview_url IS NULL OR preview_url = ''");
const noAny = await pool.query("SELECT count(*) FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND (sprite_url IS NULL OR sprite_url = '') AND (preview_url IS NULL OR preview_url = '')");

console.log("Total recordings:", total.rows[0].count);
console.log("No thumbnail:", noThumb.rows[0].count);
console.log("No sprite:", noSprite.rows[0].count);
console.log("No preview:", noPreview.rows[0].count);
console.log("No image at all:", noAny.rows[0].count);

const noThumbButPreview = await pool.query("SELECT COUNT(*) FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND preview_url IS NOT NULL AND preview_url != ''");
const noThumbButSprite = await pool.query("SELECT COUNT(*) FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND sprite_url IS NOT NULL AND sprite_url != ''");
const noThumbButPreviewOrSprite = await pool.query("SELECT COUNT(*) FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND ((preview_url IS NOT NULL AND preview_url != '') OR (sprite_url IS NOT NULL AND sprite_url != ''))");

console.log("No thumbnail but HAS preview:", noThumbButPreview.rows[0].count);
console.log("No thumbnail but HAS sprite:", noThumbButSprite.rows[0].count);
console.log("No thumbnail but HAS preview or sprite:", noThumbButPreviewOrSprite.rows[0].count);

// Show a few examples with preview URLs
const previewExamples = await pool.query("SELECT id, username, preview_url, sprite_url FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND preview_url IS NOT NULL AND preview_url != '' LIMIT 5");
console.log("\nSample recordings with preview but no thumbnail:");
for (const row of previewExamples.rows) {
  console.log(`  ${row.id} | ${row.username} | preview: ${row.preview_url?.substring(0, 80)}`);
}

// Show a few without anything
const noImg = await pool.query("SELECT id, username, filename, embed_url, stream_link FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND (sprite_url IS NULL OR sprite_url = '') AND (preview_url IS NULL OR preview_url = '') LIMIT 10");
console.log("\nRecordings with NO images at all:");
for (const row of noImg.rows) {
  console.log(`  ${row.id} | ${row.username} | ${row.filename}`);
}

await pool.end();
