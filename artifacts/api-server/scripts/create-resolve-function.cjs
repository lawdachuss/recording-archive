const { Pool } = require("pg");

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error("DATABASE_URL not set"); process.exit(1); }

  const url = new URL(dbUrl);
  const pool = new Pool({
    host: url.hostname, port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  });

  const sql = `
CREATE OR REPLACE FUNCTION resolve_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT au.email INTO v_email
  FROM auth.users au
  WHERE
    au.raw_user_meta_data->>'display_name' ILIKE p_username
    OR au.raw_user_meta_data->>'username' ILIKE p_username
  LIMIT 1;
  RETURN v_email;
END;
$$;
  `;

  try {
    await pool.query(sql);
    console.log("Function created successfully");

    const test = await pool.query("SELECT resolve_username('lawdachuss') AS email");
    console.log("Test result:", JSON.stringify(test.rows[0]));

    console.log("\nYou can now sign in with just 'lawdachuss' as your username.");
  } catch (err) {
    console.error("Error:", err.message);
  }

  await pool.end();
  process.exit(0);
}

main();
