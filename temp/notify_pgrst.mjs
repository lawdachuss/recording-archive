import pg from 'pg';
const pool = new pg.Pool({
  connectionString: '***REMOVED***',
  ssl: { rejectUnauthorized: false }
});
await pool.query("NOTIFY pgrst, 'reload schema'");
console.log('Schema cache reload notified');
await pool.end();
