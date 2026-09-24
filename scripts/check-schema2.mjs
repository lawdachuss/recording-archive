const url = 'https://supabase.chuglii.in/pg/query';
const key = '***REMOVED***';

async function query(sql) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  // watch_later_items columns
  const wl = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'watch_later_items'
    ORDER BY ordinal_position
  `);
  console.log('watch_later_items cols:', JSON.stringify(wl, null, 2));

  // watch_later_items constraints
  const wlc = await query(`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'public.watch_later_items'::regclass
  `);
  console.log('watch_later_items constraints:', JSON.stringify(wlc, null, 2));

  // performer_follows columns
  const pf = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'performer_follows'
    ORDER BY ordinal_position
  `);
  console.log('performer_follows cols:', JSON.stringify(pf, null, 2));
}

main().catch(console.error);
