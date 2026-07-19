import https from 'https';
import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path) {
  return new Promise((resolve, reject) => {
    https.get(SUPABASE_URL + path, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

function download(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const chunks = [];
    client.get(url, { timeout: 15000 }, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('timeout', function() { this.destroy(); resolve(null); })
      .on('error', () => resolve(null));
  });
}

async function main() {
  const records = await supabaseRequest(
    '/rest/v1/recordings_with_links?preview_url=is.null&sprite_url=not.is.null&sprite_url=like.*ibb.co*&select=sprite_url&limit=300'
  );
  console.error(`Found ${records.length} ibb sprites`);

  const seen = new Set();
  let dimsSummary = {};

  for (const r of records) {
    const url = r.sprite_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);

    try {
      const buf = await download(url);
      if (!buf) continue;
      const tmp = path.join('C:\\Users\\basud\\AppData\\Local\\Temp', `sprite_${randomBytes(4).toString('hex')}.webp`);
      fs.writeFileSync(tmp, buf);
      const out = execSync(
        `ffprobe -v error -show_entries stream=width,height -of default=noprint_wrappers=1 "${tmp}"`,
        { encoding: 'utf8', timeout: 5000 }
      );
      fs.unlinkSync(tmp);
      const lines = out.trim().split('\n');
      // Parse width=xxx\nheight=xxx
      let w = 0, h = 0;
      for (const l of lines) {
        if (l.startsWith('width=')) w = parseInt(l.split('=')[1], 10);
        if (l.startsWith('height=')) h = parseInt(l.split('=')[1], 10);
      }
      const key = `${w}x${h}`;
      dimsSummary[key] = (dimsSummary[key] || 0) + 1;
      if (seen.size <= 5) console.error(`${url}: ${w}x${h}`);
    } catch (e) {
      // skip
    }

    if (seen.size >= 20) break;
  }

  console.log(JSON.stringify({ sampled: seen.size, dims: dimsSummary }));
}
main().catch(e => console.error(e.message));
