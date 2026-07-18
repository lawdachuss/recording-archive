const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const cols = await client.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('channels','channel_assignments','channel_logs','recordings') AND column_name IN ('id','username','channel_id','name','status') ORDER BY table_name, ordinal_position"
  );
  console.log('Relevant columns:');
  for (const r of cols.rows) console.log(`  ${r.table_name}.${r.column_name} (${r.data_type})`);

  const counts = await client.query(
    "SELECT 'channels' t, count(*)::int c FROM channels UNION ALL SELECT 'recordings', count(*)::int FROM recordings UNION ALL SELECT 'channel_assignments', count(*)::int FROM channel_assignments"
  );
  console.log('Counts:', JSON.stringify(counts.rows));

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
