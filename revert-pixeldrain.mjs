import { Pool } from "pg";

const dbUrl = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: dbUrl.hostname, port: Number(dbUrl.port),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

const count = await pool.query("SELECT count(*) FROM recordings WHERE thumbnail_url LIKE 'https://pixeldrain.com/%'");
console.log("Pixeldrain thumbnails:", count.rows[0].count);

await pool.query("UPDATE recordings SET thumbnail_url = NULL WHERE thumbnail_url LIKE 'https://pixeldrain.com/%'");
console.log("Reverted");

const noThumb = await pool.query("SELECT count(*) FROM recordings WHERE thumbnail_url IS NULL OR thumbnail_url = ''");
console.log("Now without thumbnail:", noThumb.rows[0].count);

await pool.end();
