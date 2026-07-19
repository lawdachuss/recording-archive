import https from 'https';
import { execSync } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + path);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    };
    if (body) opts.headers['Prefer'] = 'return=minimal';
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(d ? JSON.parse(d) : null); } catch { resolve(d); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function ffprobeDuration(url) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`,
      { timeout: 60000, encoding: 'utf8', maxBuffer: 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const dur = parseFloat(out.trim());
    return isNaN(dur) ? null : dur;
  } catch { return null; }
}

async function main() {
  const all = await supabaseRequest(
    '/rest/v1/recordings_with_links?preview_url=not.is.null&select=id,preview_url'
  );
  console.error(`Total records: ${all.length}`);

  // Classify
  const classified = { supabase: [], catbox: [], x02: [], pixeldrain: [], lobfile: [], other: [] };
  for (const r of all) {
    const u = r.preview_url || '';
    if (u.includes('supabase.co/storage')) classified.supabase.push(r);
    else if (u.includes('catbox.moe')) classified.catbox.push(r);
    else if (u.includes('x02.me') || u.includes('setripupfosilpro')) classified.x02.push(r);
    else if (u.includes('pixeldrain')) classified.pixeldrain.push(r);
    else if (u.includes('lobfile.com')) classified.lobfile.push(r);
    else classified.other.push(r);
  }
  console.error(`Counts: supabase=${classified.supabase.length} catbox=${classified.catbox.length} x02=${classified.x02.length} pixeldrain=${classified.pixeldrain.length} lobfile=${classified.lobfile.length} other=${classified.other.length}`);

  // Delete lobfile (known broken)
  if (classified.lobfile.length) {
    console.error(`Deleting ${classified.lobfile.length} lobfile.com URLs...`);
    for (const r of classified.lobfile) {
      process.stdout.write(JSON.stringify({ type: 'delete_lobfile', id: r.id, url: r.preview_url }) + '\n');
      await supabaseRequest(`/rest/v1/recordings?id=eq.${r.id}`, 'PATCH', { preview_url: null });
    }
  }

  // Delete other if it's svn://, gofile.io, etc
  const otherToDelete = [];
  for (const r of classified.other) {
    const u = r.preview_url || '';
    if (u.startsWith('svn://') || u.includes('gofile.io')) {
      otherToDelete.push(r);
    }
  }
  if (otherToDelete.length) {
    console.error(`Deleting ${otherToDelete.length} other bad URLs...`);
    for (const r of otherToDelete) {
      await supabaseRequest(`/rest/v1/recordings?id=eq.${r.id}`, 'PATCH', { preview_url: null });
    }
  }

  // Remaining categories to check via ffprobe
  const checkGroups = {
    pixeldrain: classified.pixeldrain,
    supabase: classified.supabase,
    catbox: classified.catbox,
    x02: classified.x02,
  };

  // Keep remaining other that wasn't deleted
  const remainingOther = classified.other.filter(r => {
    const u = r.preview_url || '';
    return !u.startsWith('svn://') && !u.includes('gofile.io');
  });
  if (remainingOther.length) {
    checkGroups.other = remainingOther;
  }

  const MIN_DURATION = 2.0; // delete anything under 2 seconds

  for (const [host, records] of Object.entries(checkGroups)) {
    console.error(`Checking ${host}: ${records.length} records...`);
    const toDelete = [];
    // Process in sequential batches of 3
    for (let i = 0; i < records.length; i += 3) {
      const batch = records.slice(i, i + 3);
      const results = batch.map(r => ffprobeDuration(r.preview_url));
      for (let j = 0; j < batch.length; j++) {
        const dur = results[j];
        if (dur === null || dur < MIN_DURATION) {
          toDelete.push({ id: batch[j].id, url: batch[j].preview_url, dur });
          process.stdout.write(JSON.stringify({ type: 'bad', host, id: batch[j].id, dur }) + '\n');
        }
      }
      if ((i + 3) % 30 === 0) console.error(`  ${host}: ${Math.min(i + 3, records.length)}/${records.length}, bad: ${toDelete.length}`);
    }
    console.error(`  ${host}: ${toDelete.length} bad out of ${records.length}`);
    // Delete
    for (const b of toDelete) {
      await supabaseRequest(`/rest/v1/recordings?id=eq.${b.id}`, 'PATCH', { preview_url: null });
    }
  }

  console.error('Done!');
}

main().catch(e => { console.error(e.stack); process.exit(1); });
