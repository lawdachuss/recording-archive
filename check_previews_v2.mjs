import https from 'https';
import http from 'http';
import { URL } from 'url';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TMP_DIR = 'C:\\Users\\basud\\AppData\\Local\\Temp\\opencode\\preview_checks';
fs.mkdirSync(TMP_DIR, { recursive: true });

// Classify URLs by type
function classifyUrl(urlStr) {
  if (!urlStr) return 'none';
  const u = urlStr.toLowerCase();
  if (u.includes('supabase.co/storage')) return 'supabase';
  if (u.includes('catbox.moe')) return 'catbox';
  if (u.includes('x02.me') || u.includes('setripupfosilpro')) return 'x02';
  if (u.includes('pixeldrain')) return 'pixeldrain';
  if (u.includes('ibb.co') || u.includes('ibb.co')) return 'ibb';
  if (u.includes('img2.pixhost.to') || u.includes('pixhost.to')) return 'pixhost';
  if (u.endsWith('.webp') || u.endsWith('.jpg') || u.endsWith('.jpeg') || u.endsWith('.png') || u.endsWith('.gif')) return 'image_ext';
  return 'other';
}

async function supabaseRequest(path, method = 'GET', body = null) {
  const u = new URL(SUPABASE_URL + path);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    };
    if (body) opts.headers['Prefer'] = 'return=minimal';
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Get file size via HEAD
async function getFileSize(urlStr) {
  try {
    const u = new URL(urlStr);
    const client = u.protocol === 'https:' ? https : http;
    return await new Promise((resolve) => {
      const req = client.get(urlStr, { method: 'HEAD', timeout: 8000 }, (res) => {
        const cl = parseInt(res.headers['content-length'] || '0', 10);
        const cr = res.headers['content-range'] || '';
        const size = !isNaN(cl) ? cl : 0;
        res.destroy();
        resolve(size);
      });
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.on('error', () => resolve(0));
    });
  } catch { return 0; }
}

// Download first N bytes
function downloadRange(urlStr, maxBytes = 2097152) {
  const u = new URL(urlStr);
  const client = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = client.get(urlStr, {
      headers: { 'Range': `bytes=0-${maxBytes - 1}` },
      timeout: 30000
    }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', c => { chunks.push(c); total += c.length; });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function checkPreview(urlStr) {
  const type = classifyUrl(urlStr);
  
  // Immediately reject image URLs
  if (type === 'ibb' || type === 'image_ext') {
    return { dur: null, error: `image_url` };
  }
  
  // For pixeldrain, check if it's actually a video
  if (type === 'pixeldrain') {
    const size = await getFileSize(urlStr);
    if (size < 100000) { // less than 100KB
      return { dur: null, error: `too_small:${size}B` };
    }
  }

  // For supabase and catbox (which support range requests well),
  // download the file partially and use ffprobe on the local copy
  // For others, also try the same approach
  
  let tempFile = null;
  try {
    const buf = await downloadRange(urlStr, 2097152); // 2MB
    if (!buf || buf.length < 1000) {
      return { dur: null, error: 'unreachable' };
    }
    
    tempFile = path.join(TMP_DIR, randomBytes(8).toString('hex') + '.mp4');
    fs.writeFileSync(tempFile, buf);
    
    try {
      const output = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFile}"`,
        { timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const dur = parseFloat(output.trim());
      if (isNaN(dur) || dur <= 0) {
        return { dur: null, error: 'no_duration' };
      }
      return { dur, error: null };
    } catch (e) {
      return { dur: null, error: 'ffprobe_failed' };
    }
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
}

async function main() {
  // Fetch ALL recordings that have preview_url
  const allRecords = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await supabaseRequest(
      `/rest/v1/recordings_with_links?preview_url=not.is.null&select=id,preview_url,sprite_url&limit=${limit}&offset=${offset}`
    );
    if (!Array.isArray(res) || !res.length) break;
    allRecords.push(...res);
    offset += limit;
    console.error(`Fetched ${allRecords.length} records...`);
    if (res.length < limit) break;
  }

  console.error(`Total records with preview_url: ${allRecords.length}`);

  // First, classify by host and get summary
  const byHost = {};
  for (const r of allRecords) {
    const type = classifyUrl(r.preview_url);
    byHost[type] = (byHost[type] || 0) + 1;
  }
  console.error('Breakdown by host:', JSON.stringify(byHost));

  // Find clearly bad ones based on host type
  const imageUrls = allRecords.filter(r => classifyUrl(r.preview_url) === 'ibb' || classifyUrl(r.preview_url) === 'image_ext');
  console.error(`Image URLs (will delete): ${imageUrls.length}`);
  for (const r of imageUrls) {
    process.stdout.write(JSON.stringify({ type: 'bad', id: r.id, url: r.preview_url, dur: null, error: 'image_url' }) + '\n');
  }
  
  // Delete image URLs immediately
  for (const r of imageUrls) {
    await supabaseRequest(`/rest/v1/recordings?id=eq.${r.id}`, 'PATCH', { preview_url: null });
  }
  console.error(`Deleted ${imageUrls.length} image previews`);

  // For the remaining, check duration by downloading and ffprobing
  const videoRecords = allRecords.filter(r => 
    classifyUrl(r.preview_url) !== 'ibb' && 
    classifyUrl(r.preview_url) !== 'image_ext'
  );
  
  console.error(`Video previews to check: ${videoRecords.length}`);

  const badVideos = [];
  let done = 0;
  const concurrency = 3; // slow but reliable

  for (let i = 0; i < videoRecords.length; i += concurrency) {
    const batch = videoRecords.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(r => checkPreview(r.preview_url)));
    for (let j = 0; j < batch.length; j++) {
      done++;
      const r = batch[j];
      const res = results[j];
      const isShort = res.dur !== null && res.dur < 1.0;
      if (res.error || isShort) {
        badVideos.push(r);
        process.stdout.write(JSON.stringify({ 
          type: 'bad', id: r.id, dur: res.dur, error: res.error,
          host: classifyUrl(r.preview_url)
        }) + '\n');
      }
    }
    if (done % 30 === 0) console.error(`Progress: ${done}/${videoRecords.length}, bad so far: ${badVideos.length}`);
  }

  // Delete bad videos
  console.error(`Bad videos to delete: ${badVideos.length}`);
  for (let i = 0; i < badVideos.length; i++) {
    await supabaseRequest(`/rest/v1/recordings?id=eq.${badVideos[i].id}`, 'PATCH', { preview_url: null });
    if ((i + 1) % 100 === 0) console.error(`Deleted ${i + 1}/${badVideos.length}`);
  }

  process.stdout.write(JSON.stringify({ 
    type: 'summary', 
    total: allRecords.length, 
    image_bad: imageUrls.length, 
    video_bad: badVideos.length,
    remaining: allRecords.length - imageUrls.length - badVideos.length
  }) + '\n');
}

main().catch(e => { console.error(e.stack); process.exit(1); });
