import pg from 'pg';
const pool = new pg.Pool({
  connectionString: 'postgresql://postgres.rvbuzyljrwsxfxijotdf:Basudevkr123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
const res = await pool.query("SELECT pg_get_viewdef('recordings_with_links'::regclass, true) AS view_def");
console.log('View definition:');
console.log(res.rows[0].view_def);
await pool.end();
