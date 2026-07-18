const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  await client.query('BEGIN READ WRITE');

  const recs = await client.query(
    "SELECT id, filename FROM recordings WHERE duration > 7200 ORDER BY duration DESC"
  );
  const ids = recs.rows.map(r => r.id);
  console.log(`Recordings to delete: ${ids.length}`);

  if (ids.length === 0) {
    await client.query('ROLLBACK');
    await client.end();
    return;
  }

  const placeholders = ids.map((_, i) => '$' + (i + 1)).join(',');

  const tables = [
    'comments', 'reactions', 'saved_videos', 'watch_history',
    'watch_later_items', 'user_collection_items',
    'preview_images', 'upload_links'
  ];

  for (const table of tables) {
    try {
      const res = await client.query(`DELETE FROM ${table} WHERE recording_id IN (${placeholders})`, ids);
      if (res.rowCount > 0) console.log(`Deleted ${res.rowCount} from ${table}`);
    } catch (e) {
      console.log(`Skip ${table}: ${e.message}`);
    }
  }

  try {
    const cl = await client.query(
      `DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE recording_id IN (${placeholders}))`,
      ids
    );
    if (cl.rowCount > 0) console.log(`Deleted ${cl.rowCount} from comment_likes`);
  } catch (e) {
    console.log(`Skip comment_likes: ${e.message}`);
  }

  // upload_journal references by filename
  let ujTotal = 0;
  for (const rec of recs.rows) {
    const res = await client.query(
      "DELETE FROM upload_journal WHERE filename LIKE $1",
      ['%' + rec.filename.replace(/\s/g, '') + '%']
    );
    ujTotal += res.rowCount;
  }
  if (ujTotal > 0) console.log(`Deleted ${ujTotal} from upload_journal`);

  // recent_activity is a VIEW derived from recordings + channel_logs.

  const res = await client.query(`DELETE FROM recordings WHERE id IN (${placeholders})`, ids);
  console.log(`Deleted ${res.rowCount} recordings`);

  await client.query('COMMIT');
  console.log('Done.');
  await client.end();
}

run().catch(async e => {
  console.error('Error:', e.message);
  try { await client.query('ROLLBACK'); } catch (_) {}
  process.exit(1);
});
