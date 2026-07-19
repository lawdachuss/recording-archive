import pg from 'pg';
const pool = new pg.Pool({
  connectionString: 'postgresql://postgres.rvbuzyljrwsxfxijotdf:Basudevkr123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'recordings_with_links' AND column_name = 'sprite_vtt_url'");
console.log('sprite_vtt_url in view:', res.rows.length > 0 ? 'YES' : 'NO');
await pool.end();
