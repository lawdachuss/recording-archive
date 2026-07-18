const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
client.connect()
  .then(() => client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('comments','reactions','saved_videos','watch_history','watch_later_items','user_collection_items','upload_journal','recent_activity') ORDER BY table_name, ordinal_position"))
  .then(res => {
    let current = '';
    res.rows.forEach(r => {
      if (r.table_name !== current) { console.log('\n' + r.table_name + ':'); current = r.table_name; }
      console.log('  ' + r.column_name);
    });
    return client.end();
  })
  .catch(err => { console.error('Error:', err.message); client.end(); });
