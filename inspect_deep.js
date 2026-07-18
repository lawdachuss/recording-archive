const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  // A) Case-insensitive check: unknown channels that DO match a channel when lowercased
  const caseMis = await client.query(
    `SELECT count(DISTINCT r.username)::int c
     FROM recordings r
     WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = r.username)
       AND EXISTS (SELECT 1 FROM channels c WHERE lower(c.username) = lower(r.username))`
  );
  console.log('A) Unknown (exact) but match a channel case-insensitively:', caseMis.rows[0].c);

  // B) Unknown recording usernames that ALSO appear in channel_assignments
  const unkInAssign = await client.query(
    `SELECT count(DISTINCT r.username)::int c
     FROM recordings r
     WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = r.username)
       AND EXISTS (SELECT 1 FROM channel_assignments a WHERE a.username = r.username)`
  );
  console.log('B) Unknown channels that ARE in channel_assignments:', unkInAssign.rows[0].c);

  // C) Totals for the 251 unknown channels: #recordings, sum filesize
  const agg = await client.query(
    `SELECT count(*)::int recs, coalesce(sum(filesize),0)::bigint bytes
     FROM recordings r
     WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = r.username)`
  );
  console.log('C) Unknown-channel recordings:', agg.rows[0].recs, '| total bytes:', agg.rows[0].bytes, '(~' + (agg.rows[0].bytes/1e9).toFixed(2) + ' GB)');

  // D) The 26 empty channels: do any appear in channel_assignments?
  const emptyInAssign = await client.query(
    `SELECT count(*)::int c FROM channels c
     WHERE NOT EXISTS (SELECT 1 FROM recordings r WHERE r.username = c.username)
       AND EXISTS (SELECT 1 FROM channel_assignments a WHERE a.username = c.username)`
  );
  console.log('D) Empty channels that ARE in channel_assignments:', emptyInAssign.rows[0].c);

  // E) Are there recordings whose username is NULL / blank?
  const nullUser = await client.query(
    `SELECT count(*)::int c FROM recordings WHERE username IS NULL OR username = ''`
  );
  console.log('E) Recordings with NULL/empty username:', nullUser.rows[0].c);

  // F) Sample: top unknown channels by recording count
  const top = await client.query(
    `SELECT r.username, count(*)::int c, max(created_at) last
     FROM recordings r
     WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = r.username)
     GROUP BY r.username ORDER BY c DESC LIMIT 15`
  );
  console.log('F) Top unknown channels by #recordings:');
  for (const r of top.rows) console.log(`   ${r.username}: ${r.c} (last ${r.last})`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
