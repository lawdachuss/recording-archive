import pg from 'pg';
const pool = new pg.Pool({
  connectionString: 'postgresql://postgres.rvbuzyljrwsxfxijotdf:Basudevkr123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
await pool.query("NOTIFY pgrst, 'reload schema'");
console.log('Schema cache reload notified');
await pool.end();
