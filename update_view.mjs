import pg from 'pg';
const pool = new pg.Pool({
  connectionString: 'postgresql://postgres.rvbuzyljrwsxfxijotdf:Basudevkr123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

await pool.query('DROP VIEW IF EXISTS recordings_with_links CASCADE');
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
    NULLIF(jsonb_object_agg(ul.host, ul.url) FILTER (WHERE ul.host IS NOT NULL), '{}'::jsonb)::json AS links
   FROM recordings r
     LEFT JOIN upload_links ul ON r.id = ul.recording_id
  GROUP BY r.id;
`);

const res = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE links IS NULL) AS null_links,
    COUNT(*) FILTER (WHERE links IS NOT NULL AND links::text = '{}') AS empty_links,
    COUNT(*) FILTER (WHERE links IS NOT NULL AND links::text <> '{}') AS real_links
  FROM recordings_with_links
`);
console.log('After NULLIF fix:', res.rows[0]);
await pool.end();
