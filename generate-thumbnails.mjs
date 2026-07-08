import { Pool } from "pg";
import { execSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { request } from "https";

const FFMPEG = "C:\\Users\\basud\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe";
const PIXELDRAIN_KEY = "aa95a8ad-2a84-4f9f-8b2a-35da67fd5b8e";
const AUTH = Buffer.from(":" + PIXELDRAIN_KEY).toString("base64");

const dbUrl = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: dbUrl.hostname, port: Number(dbUrl.port),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

function uploadToPixeldrain(filePath) {
  return new Promise((resolve, reject) => {
    const boundary = "----" + Math.random().toString(36).slice(2);
    const fileData = readFileSync(filePath);
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="thumb.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, fileData, tail]);

    const req = request({
      hostname: "pixeldrain.com",
      path: "/api/file",
      method: "POST",
      headers: {
        Authorization: "Basic " + AUTH,
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "Content-Length": body.length,
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (j.success) resolve(j.id);
          else reject(new Error(j.message));
        } catch { reject(new Error(data)); }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function main() {
  const rows = await pool.query(
    "SELECT id, username, preview_url FROM recordings WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND preview_url IS NOT NULL AND preview_url != ''"
  );

  console.log("Processing " + rows.rows.length + " recordings...");

  for (const row of rows.rows) {
    const { id, username, preview_url } = row;
    const tmpFile = join(tmpdir(), "thumb-" + id.slice(0, 8) + ".jpg");

    console.log("\n[" + username + "] Extracting frame...");

    try {
      execSync(
        '"' + FFMPEG + '" -i "' + preview_url + '" -ss 00:00:02 -vframes 1 -f image2 -update 1 "' + tmpFile + '" -y',
        { stdio: "pipe", timeout: 30000 }
      );

      console.log("  Uploading to Pixeldrain...");
      const fileId = await uploadToPixeldrain(tmpFile);
      const thumbnailUrl = "https://pixeldrain.com/api/file/" + fileId;

      await pool.query("UPDATE recordings SET thumbnail_url = $1 WHERE id = $2", [thumbnailUrl, id]);
      console.log("  Done: " + thumbnailUrl);
    } catch (err) {
      console.error("  Failed: " + err.message);
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  }

  console.log("\nAll done!");
  await pool.end();
}

main().catch(console.error);
