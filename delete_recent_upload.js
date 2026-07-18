const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  // The Supabase transaction pooler forces read-only outside an explicit
  // read-write transaction, so wrap everything in BEGIN READ WRITE ... COMMIT.
  await client.query('BEGIN READ WRITE');

  // Find the single most recent upload under 30 minutes old
  const recs = await client.query(
    "SELECT id, filename, username, created_at FROM recordings WHERE created_at >= NOW() - INTERVAL '30 minutes' ORDER BY created_at DESC LIMIT 1"
  );

  if (recs.rows.length === 0) {
    console.log('No upload found under 30 minutes.');
    await client.query('ROLLBACK');
    await client.end();
    return;
  }

  const rec = recs.rows[0];
  const id = rec.id;
  console.log('Target upload to delete:', JSON.stringify(rec, null, 2));

  const tables = [
    'comments', 'reactions', 'saved_videos', 'watch_history',
    'watch_later_items', 'user_collection_items',
    'preview_images', 'upload_links'
  ];

  for (const table of tables) {
    try {
      const res = await client.query(`DELETE FROM ${table} WHERE recording_id = $1`, [id]);
      if (res.rowCount > 0) console.log(`Deleted ${res.rowCount} from ${table}`);
    } catch (e) {
      console.log(`Skip ${table}: ${e.message}`);
    }
  }

  try {
    const cl = await client.query(
      "DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE recording_id = $1)",
      [id]
    );
    if (cl.rowCount > 0) console.log(`Deleted ${cl.rowCount} from comment_likes`);
  } catch (e) {
    console.log(`Skip comment_likes: ${e.message}`);
  }

  const uj = await client.query(
    "DELETE FROM upload_journal WHERE filename LIKE $1",
    ['%' + rec.filename.replace(/\s/g, '') + '%']
  );
  if (uj.rowCount > 0) console.log(`Deleted ${uj.rowCount} from upload_journal`);

  // recent_activity is a VIEW built from recordings + channel_logs, so deleting the
  // recording automatically removes its row from the view.

  const res = await client.query("DELETE FROM recordings WHERE id = $1", [id]);
  console.log(`Deleted ${res.rowCount} recording`);

  await client.query('COMMIT');
  console.log('Done.');
  await client.end();
}

run().catch(async e => {
  console.error('Error:', e.message);
  try { await client.query('ROLLBACK'); } catch (_) {}
  process.exit(1);
});
