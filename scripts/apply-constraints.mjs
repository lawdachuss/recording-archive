import { requireKey } from "./env.mjs";
const url = 'https://supabase.chuglii.in/pg/query';
const key = requireKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY");

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
  // 1. Add UNIQUE constraint on watch_later_items(user_id, recording_id)
  console.log('Adding UNIQUE on watch_later_items(user_id, recording_id)...');
  const r1 = await query(`
    ALTER TABLE public.watch_later_items
      ADD CONSTRAINT watch_later_items_user_recording_unique
      UNIQUE (user_id, recording_id)
  `);
  console.log('Result:', JSON.stringify(r1));

  // 2. Add UNIQUE constraint on performer_follows(user_id, performer_username)
  console.log('Adding UNIQUE on performer_follows(user_id, performer_username)...');
  const r2 = await query(`
    ALTER TABLE public.performer_follows
      ADD CONSTRAINT performer_follows_user_performer_unique
      UNIQUE (user_id, performer_username)
  `);
  console.log('Result:', JSON.stringify(r2));

  // 3. Verify both constraints exist
  const verify = await query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name IN ('watch_later_items', 'performer_follows')
      AND tc.constraint_type = 'UNIQUE'
  `);
  console.log('Verified UNIQUE constraints:', JSON.stringify(verify, null, 2));
}

main().catch(console.error);
