import https from 'https';
import { execSync } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function req(path) {
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

function probe(url) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${url}"`,
      { timeout: 30000, encoding: 'utf8', maxBuffer: 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return parseFloat(out.trim());
  } catch { return null; }
}

async function main() {
  const all = await req('/rest/v1/recordings_with_links?preview_url=not.is.null&select=id,preview_url');

  const byHost = { supabase: [], catbox: [], x02: [], pixeldrain: [], other: [] };
  for (const r of all) {
    const u = r.preview_url || '';
    if (u.includes('supabase.co/storage')) byHost.supabase.push(r);
    else if (u.includes('catbox.moe')) byHost.catbox.push(r);
    else if (u.includes('x02.me') || u.includes('setripupfosilpro')) byHost.x02.push(r);
    else if (u.includes('pixeldrain')) byHost.pixeldrain.push(r);
    else byHost.other.push(r);
  }

  console.log(JSON.stringify({ counts: Object.fromEntries(Object.entries(byHost).map(([k, v]) => [k, v.length])) }));

  const samples = {
    pixeldrain: byHost.pixeldrain.slice(0, 3),
    supabase: byHost.supabase.slice(0, 3),
    catbox: byHost.catbox.slice(0, 3),
    x02: byHost.x02.slice(0, 3),
    other: byHost.other.slice(0, 5)
  };

  for (const [host, records] of Object.entries(samples)) {
    console.log(`=== ${host} ===`);
    for (const r of records) {
      const dur = probe(r.preview_url);
      process.stdout.write(JSON.stringify({ id: r.id, dur, url: r.preview_url }) + '\n');
    }
  }
}
main().catch(e => console.error(e.message));
