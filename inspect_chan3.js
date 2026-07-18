const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const totalChannels = await client.query('SELECT count(*)::int c FROM channels');
  console.log('Total channels:', totalChannels.rows[0].c);

  const distinctRecUsers = await client.query('SELECT count(DISTINCT username)::int c FROM recordings');
  console.log('Distinct recording usernames:', distinctRecUsers.rows[0].c);

  const recNoChan = await client.query(
    "SELECT count(DISTINCT r.username)::int c FROM recordings r WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = r.username)"
  );
  console.log('Recording usernames NOT in channels (unknown channels):', recNoChan.rows[0].c);

  const chanNoRec = await client.query(
    "SELECT count(*)::int c FROM channels c WHERE NOT EXISTS (SELECT 1 FROM recordings r WHERE r.username = c.username)"
  );
  console.log('Channels with NO matching recordings:', chanNoRec.rows[0].c);

  const assignNoChan = await client.query(
    "SELECT count(*)::int c FROM channel_assignments a WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.username = a.username)"
  );
  console.log('Assignments with username NOT in channels:', assignNoChan.rows[0].c);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
