import pg from 'pg';
const pool = new pg.Pool({
  connectionString: 'postgresql://postgres.rvbuzyljrwsxfxijotdf:Basudevkr123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

// First remove the existing view
await pool.query('DROP VIEW IF EXISTS recordings_with_links CASCADE');

// Recreate with sprite_vtt_url included
await pool.query(`
CREATE VIEW recordings_with_links AS
 SELECT r.id,
    r.channel_id,
    r.username,
    r.filename,
    r."timestamp",
    r.room_title,
    r.tags,
    r.viewers,
    r.resolution,
    r.framerate,
    r.filesize,
    r.duration,
    r.gender,
    r.thumbnail_url,
    r.sprite_url,
    r.embed_url,
    r.preview_url,
    r.sprite_vtt_url,
    r.instance_id,
    r.created_at,
    r.updated_at,
    COALESCE(json_object_agg(ul.host, ul.url) FILTER (WHERE ul.host IS NOT NULL), '{}'::json) AS links
   FROM recordings r
     LEFT JOIN upload_links ul ON r.id = ul.recording_id
  GROUP BY r.id;
`);

console.log('View recreated successfully');

// Verify the column is now in the view
const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings_with_links' AND column_name = 'sprite_vtt_url'");
console.log('sprite_vtt_url in view:', res.rows.length > 0 ? 'YES' : 'NO');

await pool.end();
