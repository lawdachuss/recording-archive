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
  v_our_id TEXT := '042f11b1-8b0a-4c12-b6cb-091b33e6d64f';
BEGIN
  -- First try to find our specific user
  SELECT au.email INTO v_email
  FROM auth.users au
    WHERE au.id = v_our_id::uuid
    AND (
      au.raw_user_meta_data->>'display_name' ILIKE p_username
      OR au.raw_user_meta_data->>'username' ILIKE p_username
    )
  LIMIT 1;

  -- Fallback: any user with matching display_name/username
  IF v_email IS NULL THEN
    SELECT au.email INTO v_email
    FROM auth.users au
    WHERE
      au.raw_user_meta_data->>'display_name' ILIKE p_username
      OR au.raw_user_meta_data->>'username' ILIKE p_username
    LIMIT 1;
  END IF;

  RETURN v_email;
END;
$$;
  `;

  try {
    await pool.query(sql);
    console.log("Function updated");

    const test = await pool.query("SELECT resolve_username('lawdachuss') AS email");
    console.log("Username 'lawdachuss' resolves to:", test.rows[0].email);

  } catch (err) {
    console.error("Error:", err.message);
  }

  await pool.end();
  process.exit(0);
}

main();
