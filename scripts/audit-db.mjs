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
  // 1. All public tables
  const tables = await query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log('ALL TABLES:', tables.map(t => t.table_name));

  // 2. user_profiles columns
  const ups = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
    ORDER BY ordinal_position
  `);
  console.log('user_profiles cols:', ups);

  // 3. Check watch_later exists
  const wl = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'watch_later'
    ORDER BY ordinal_position
  `);
  console.log('watch_later cols:', wl);

  // 4. Check performer_follows unique constraints
  const pfConstraints = await query(`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'public.performer_follows'::regclass
  `);
  console.log('performer_follows constraints:', pfConstraints);

  // 5. Check user_profiles unique constraints
  const upConstraints = await query(`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'public.user_profiles'::regclass
  `);
  console.log('user_profiles constraints:', upConstraints);
}

main().catch(console.error);
