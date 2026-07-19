import https from 'https';
import http from 'http';
import { URL } from 'url';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fetchRange(urlStr, maxBytes = 65536) {
  const u = new URL(urlStr);
  const client = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = client.get(urlStr, {
      headers: { 'Range': `bytes=0-${maxBytes - 1}` },
      timeout: 15000
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function parseMp4Duration(buf) {
  if (!buf || buf.length < 8) return null;
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (size < 8) break;
    if (type === 'moov') {
      return parseMoov(buf.subarray(offset, offset + Math.min(size, buf.length - offset)));
    }
    offset += size === 0 ? 1 : size;
  }
  return null;
}

function parseMoov(buf) {
  if (buf.length < 8) return null;
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (size < 8) break;
    if (type === 'mvhd') {
      const mvhd = buf.subarray(offset + 4, offset + Math.min(size - 4, buf.length - offset - 4));
      if (mvhd.length < 20) return null;
      const version = mvhd.readUInt8(4);
      const timescale = mvhd.readUInt32BE(12);
      if (timescale === 0) return null;
      if (version === 0) {
        if (mvhd.length < 20) return null;
        const duration = mvhd.readUInt32BE(16);
        return duration / timescale;
      } else if (version === 1) {
        if (mvhd.length < 28) return null;
        const durationHi = mvhd.readUInt32BE(20);
        const durationLo = mvhd.readUInt32BE(24);
        const duration = durationHi * 4294967296 + durationLo;
        return duration / timescale;
      }
      return null;
    }
    offset += size === 0 ? 1 : size;
  }
  return null;
}

async function checkContentType(urlStr) {
  try {
    const u = new URL(urlStr);
    const client = u.protocol === 'https:' ? https : http;
    return await new Promise((resolve) => {
      const req = client.get(urlStr, { timeout: 8000, method: 'HEAD' }, (res) => {
        resolve(res.headers['content-type'] || '');
        res.destroy();
      });
      req.on('timeout', () => { req.destroy(); resolve('timeout'); });
      req.on('error', () => resolve('error'));
    });
  } catch { return 'error'; }
}

async function checkOne(urlStr) {
  if (!urlStr) return { dur: null, error: 'no_url' };

  const type = await checkContentType(urlStr);
  if (type && type !== 'error' && type !== 'timeout') {
    if (type.startsWith('image/')) {
      return { dur: null, error: `image:${type}` };
    }
  }

  const buf = await fetchRange(urlStr, 65536);
  if (!buf || buf.length < 100) return { dur: null, error: 'unreachable' };

  const dur = parseMp4Duration(buf);
  if (dur === null) {
    // Try downloading more (moov might be at end for non-fast-start files)
    const buf2 = await fetchRange(urlStr, 1048576); // 1MB
    const dur2 = parseMp4Duration(buf2);
    return { dur: dur2, error: dur2 === null ? 'no_moov' : null };
  }
  return { dur, error: null };
}

async function main() {
  const allRecords = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await new Promise((resolve, reject) => {
      https.get(`${SUPABASE_URL}/rest/v1/recordings_with_links?preview_url=not.is.null&select=id,preview_url&limit=${limit}&offset=${offset}`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve([]); } });
      }).on('error', reject);
    });
    if (!Array.isArray(res) || !res.length) break;
    allRecords.push(...res);
    offset += limit;
    console.error(`Fetched ${allRecords.length} records...`);
    if (res.length < limit) break;
  }

  process.stdout.write(JSON.stringify({ total: allRecords.length }) + '\n');

  const bad = [];
  let done = 0;
  const concurrency = 10;

  for (let i = 0; i < allRecords.length; i += concurrency) {
    const batch = allRecords.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(r => checkOne(r.preview_url)));
    for (let j = 0; j < batch.length; j++) {
      done++;
      const r = batch[j];
      const res = results[j];
      const isShort = res.dur !== null && res.dur < 1.0;
      if (res.error || isShort) {
        bad.push({ id: r.id, url: r.preview_url, dur: res.dur, error: res.error });
        process.stdout.write(JSON.stringify({ type: 'bad', id: r.id, dur: res.dur, error: res.error }) + '\n');
      }
    }
    if (done % 100 === 0) console.error(`Progress: ${done}/${allRecords.length}`);
  }

  process.stdout.write(JSON.stringify({ type: 'summary', total: allRecords.length, bad: bad.length }) + '\n');

  if (bad.length) {
    // Delete bad previews from recordings table
    const tableUrl = `${SUPABASE_URL}/rest/v1/recordings`;
    for (let i = 0; i < bad.length; i++) {
      const b = bad[i];
      await new Promise((resolve, reject) => {
        const req = https.request(`${tableUrl}?id=eq.${b.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          }
        }, (res) => { res.resume(); res.on('end', resolve); });
        req.on('error', reject);
        req.write(JSON.stringify({ preview_url: null }));
        req.end();
      });
      if ((i + 1) % 50 === 0) console.error(`Deleted ${i + 1}/${bad.length}`);
    }
    process.stdout.write(JSON.stringify({ type: 'deleted', count: bad.length }) + '\n');
  }
}

main().catch(e => { console.error(e.stack); process.exit(1); });
