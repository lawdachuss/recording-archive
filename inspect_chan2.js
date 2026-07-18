const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  // 1. Recordings whose channel_id is NOT in channels (orphaned recordings)
  const orphanRec = await client.query(
    "SELECT count(*)::int AS c FROM recordings r WHERE r.channel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM channels c WHERE c.id = r.channel_id)"
  );
  console.log('Recordings with channel_id NOT in channels:', orphanRec.rows[0].c);

  const nullChan = await client.query(
    "SELECT count(*)::int AS c FROM recordings WHERE channel_id IS NULL"
  );
  console.log('Recordings with NULL channel_id:', nullChan.rows[0].c);

  // 2. Channels that have NO recordings
  const chanNoRec = await client.query(
    "SELECT c.id, c.username FROM channels c WHERE NOT EXISTS (SELECT 1 FROM recordings r WHERE r.channel_id = c.id) ORDER BY c.username LIMIT 50"
  );
  console.log('Channels with NO recordings (count):', chanNoRec.rows.length);
  console.log(chanNoRec.rows.map(r => r.username).join(', '));

  // 3. channel_assignments usernames not present in channels
  const assignNoChan = await client.query(
    "SELECT a.username, a.status FROM channel_assignments a WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = a.username) ORDER BY a.username LIMIT 50"
  );
  console.log('channel_assignments usernames NOT in channels (count):', assignNoChan.rows.length);
  console.log(assignNoChan.rows.map(r => r.username + '(' + r.status + ')').join(', '));

  // 4. recordings usernames not present in channels
  const recNoChan = await client.query(
    "SELECT DISTINCT r.username FROM recordings r WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = r.username) ORDER BY r.username LIMIT 50"
  );
  console.log('recordings usernames NOT in channels (count):', recNoChan.rows.length);
  console.log(recNoChan.rows.map(r => r.username).join(', '));

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
