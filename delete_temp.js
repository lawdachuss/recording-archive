const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.xhfbhgklqylmfmfjtgkq:Basudevkr%40123@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    
    // Find recordings from last hour
    const recs = await client.query(
      "SELECT id, filename, username, created_at FROM recordings WHERE created_at >= NOW() - INTERVAL '1 hour' ORDER BY created_at DESC"
    );
    console.log('Recordings to delete:', recs.rows.length);
    const ids = recs.rows.map(r => r.id);
    console.log(ids);

    if (ids.length === 0) {
      console.log('Nothing to delete.');
      await client.end();
      return;
    }

    // Delete from related tables
    const placeholders = ids.map((_, i) => '$' + (i + 1)).join(',');

    const tables = [
      'comments', 'reactions', 'saved_videos', 'watch_history', 
      'watch_later_items', 'user_collection_items'
    ];
    
    for (const table of tables) {
      try {
        const q = `DELETE FROM ${table} WHERE recording_id IN (${placeholders})`;
        const res = await client.query(q, ids);
        if (res.rowCount > 0) console.log(`Deleted ${res.rowCount} from ${table}`);
      } catch (e) {
        // Table might not have recording_id column
      }
    }

    // Delete recent_activity (by description matching recording filename or activity_time)
    for (const rec of recs.rows) {
      const res = await client.query(
        "DELETE FROM recent_activity WHERE activity_time >= NOW() - INTERVAL '1 hour' AND description LIKE $1",
        ['%' + rec.filename.replace(/\s/g, '') + '%']
      );
      if (res.rowCount > 0) console.log(`Deleted ${res.rowCount} from recent_activity for ${rec.filename}`);
    }

    // Delete upload_journal entries for those filenames
    for (const rec of recs.rows) {
      const res = await client.query(
        "DELETE FROM upload_journal WHERE filename LIKE $1",
        ['%' + rec.filename.replace(/\s/g, '') + '%']
      );
      if (res.rowCount > 0) console.log(`Deleted ${res.rowCount} from upload_journal for ${rec.filename}`);
    }

    // Delete the recordings themselves
    const res = await client.query(
      `DELETE FROM recordings WHERE id IN (${placeholders})`,
      ids
    );
    console.log(`Deleted ${res.rowCount} recordings`);

    console.log('Done.');
  } catch (err) {
    console.error('Error:', err.message);
  }
  await client.end();
}

run();
