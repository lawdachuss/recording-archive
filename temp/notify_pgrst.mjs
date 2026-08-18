import pg from 'pg';
const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:Basudevkr123@db.dydfzytjwhrqozuiexbb.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
await pool.query("NOTIFY pgrst, 'reload schema'");
console.log('Schema cache reload notified');
await pool.end();
