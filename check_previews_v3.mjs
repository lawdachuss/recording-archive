import https from 'https';
import http from 'http';
import { URL } from 'url';
import { execSync } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseRequest(path, method = 'GET', body = null) {
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

function classifyUrl(urlStr) {
  if (!urlStr) return 'none';
  const u = urlStr.toLowerCase();
  if (u.includes('supabase.co/storage')) return 'supabase';
  if (u.includes('catbox.moe')) return 'catbox';
  if (u.includes('x02.me') || u.includes('setripupfosilpro')) return 'x02';
  if (u.includes('pixeldrain')) return 'pixeldrain';
  if (u.includes('ibb.co')) return 'ibb';
  if (u.endsWith('.webp') || u.endsWith('.jpg') || u.endsWith('.jpeg') || u.endsWith('.png') || u.endsWith('.gif')) return 'image_ext';
  return 'other';
}

async function checkWithFfprobe(urlStr) {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${urlStr}"`,
      { timeout: 60000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 }
    );
    const dur = parseFloat(output.trim());
    if (isNaN(dur) || dur <= 0) return null;
    return dur;
  } catch {
    return null;
  }
}

async function main() {
  // Fetch all recordings with preview_url
  const allRecords = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await supabaseRequest(
      `/rest/v1/recordings_with_links?preview_url=not.is.null&select=id,preview_url&limit=${limit}&offset=${offset}`
    );
    if (!Array.isArray(res) || !res.length) break;
    allRecords.push(...res);
    offset += limit;
    console.error(`Fetched ${allRecords.length} records...`);
    if (res.length < limit) break;
  }
  console.error(`Total: ${allRecords.length}`);

  // Phase 1: Delete image URLs immediately (no probe needed)
  const imageUrls = allRecords.filter(r => {
    const t = classifyUrl(r.preview_url);
    return t === 'ibb' || t === 'image_ext';
  });
  console.error(`Image URLs to delete (no probe): ${imageUrls.length}`);
  for (const r of imageUrls) {
    await supabaseRequest(`/rest/v1/recordings?id=eq.${r.id}`, 'PATCH', { preview_url: null });
  }
  console.error(`Deleted ${imageUrls.length} image previews`);

  // Phase 2: Check video previews with ffprobe
  const videoRecords = allRecords.filter(r => {
    const t = classifyUrl(r.preview_url);
    return t !== 'ibb' && t !== 'image_ext';
  });
  console.error(`Video previews to check: ${videoRecords.length}`);

  const badVideos = [];
  let done = 0;
  const concurrency = 3;

  for (let i = 0; i < videoRecords.length; i += concurrency) {
    const batch = videoRecords.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(r => checkWithFfprobe(r.preview_url)));
    for (let j = 0; j < batch.length; j++) {
      done++;
      const r = batch[j];
      const dur = results[j];
      if (dur === null || dur < 1.0) {
        badVideos.push(r);
        process.stdout.write(JSON.stringify({ 
          type: 'bad', id: r.id, dur, host: classifyUrl(r.preview_url)
        }) + '\n');
      }
    }
    if (done % 50 === 0) console.error(`Progress: ${done}/${videoRecords.length}, bad: ${badVideos.length}`);
  }

  // Delete bad video previews
  console.error(`Bad videos to delete: ${badVideos.length}`);
  for (let i = 0; i < badVideos.length; i++) {
    await supabaseRequest(`/rest/v1/recordings?id=eq.${badVideos[i].id}`, 'PATCH', { preview_url: null });
    if ((i + 1) % 100 === 0) console.error(`Deleted ${i + 1}/${badVideos.length}`);
  }

  process.stdout.write(JSON.stringify({
    type: 'summary',
    total: allRecords.length,
    image_deleted: imageUrls.length,
    video_deleted: badVideos.length,
    remaining: allRecords.length - imageUrls.length - badVideos.length
  }) + '\n');
}

main().catch(e => { console.error(e.stack); process.exit(1); });
