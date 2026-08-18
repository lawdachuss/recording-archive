// Null out DEAD preview_url values only:
//  - rvbuzyljrwsxfxijotdf.supabase.co (old storage, all confirmed 402) -> null all
//  - files.catbox.moe -> probe EVERY url; null only 0-byte / failed ones.
//    (some catbox files are genuinely alive — they are kept!)
// Dry-run by default; pass --apply to execute.
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadEnv(file) {
  const env = {};
  try {
    const txt = fs.readFileSync(file, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return env;
}

const env = { ...loadEnv(path.resolve(".env")), ...loadEnv(path.resolve("artifacts/api-server/.env")) };
const dbUrl = env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set in .env");
  process.exit(1);
}

const url = new URL(dbUrl);
const pool = new Pool({
  host: url.hostname,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

async function probe(urlStr) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(urlStr, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes: buf.length };
  } catch (e) {
    return { error: true };
  }
}

async function probeAll(urls, concurrency = 15, onProgress) {
  const results = new Array(urls.length);
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      results[idx] = await probe(urls[idx]);
      if (onProgress && (idx + 1) % 200 === 0) onProgress(idx + 1, urls.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  const apply = process.argv.includes("--apply");

  // ── 1) Old-storage host: all confirmed 402 -> null all ─────────────
  const oldStorage = await pool.query(
    `SELECT count(*)::int AS n FROM recordings
     WHERE preview_url LIKE 'https://rvbuzyljrwsxfxijotdf.supabase.co/%' AND preview_url IS NOT NULL`
  );
  console.log(`Old-storage rows (402, all dead): ${oldStorage.rows[0].n}`);

  // ── 2) Catbox: probe every row ─────────────────────────────────────
  const catbox = await pool.query(
    `SELECT id, preview_url FROM recordings
     WHERE preview_url LIKE 'https://files.catbox.moe/%' AND preview_url IS NOT NULL`
  );
  const catboxRows = catbox.rows;
  console.log(`Catbox rows to probe: ${catboxRows.length}`);
  const infos = await probeAll(catboxRows.map((r) => r.preview_url), 15, (done, total) =>
    console.error(`  probed ${done}/${total}...`)
  );

  const deadCatbox = catboxRows.filter((r, i) => {
    const info = infos[i];
    const alive = info && !info.error && info.status >= 200 && info.status < 300 && info.bytes > 0;
    return !alive;
  });
  const aliveCatbox = catboxRows.length - deadCatbox.length;
  console.log(`Catbox: ${deadCatbox.length} dead, ${aliveCatbox} alive (kept)`);

  if (!apply) {
    console.log("\nDRY RUN — pass --apply to null", oldStorage.rows[0].n + deadCatbox.length, "rows");
    await pool.end();
    return;
  }

  // Null old-storage rows
  const res1 = await pool.query(
    `UPDATE recordings SET preview_url = NULL
     WHERE preview_url LIKE 'https://rvbuzyljrwsxfxijotdf.supabase.co/%' AND preview_url IS NOT NULL`
  );
  console.log(`Old-storage nulled: ${res1.rowCount}`);

  // Null dead catbox rows (chunked to avoid huge param arrays)
  let nulled2 = 0;
  const CHUNK = 300;
  for (let i = 0; i < deadCatbox.length; i += CHUNK) {
    const chunk = deadCatbox.slice(i, i + CHUNK).map((r) => r.preview_url);
    const res2 = await pool.query(
      `UPDATE recordings SET preview_url = NULL WHERE preview_url = ANY($1::text[])`,
      [chunk]
    );
    nulled2 += res2.rowCount;
  }
  console.log(`Catbox dead nulled: ${nulled2}`);

  // ── Verify ─────────────────────────────────────────────────────────
  const remainOld = await pool.query(
    `SELECT count(*)::int AS n FROM recordings
     WHERE preview_url LIKE 'https://rvbuzyljrwsxfxijotdf.supabase.co/%' AND preview_url IS NOT NULL`
  );
  const remainCatbox = await pool.query(
    `SELECT count(*)::int AS n FROM recordings
     WHERE preview_url LIKE 'https://files.catbox.moe/%' AND preview_url IS NOT NULL`
  );
  const total = await pool.query(
    `SELECT count(*)::int AS n FROM recordings WHERE preview_url IS NOT NULL`
  );
  console.log(`Remaining old-storage rows: ${remainOld.rows[0].n}`);
  console.log(`Remaining catbox rows: ${remainCatbox.rows[0].n}`);
  console.log(`Recordings still having a preview_url: ${total.rows[0].n}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
