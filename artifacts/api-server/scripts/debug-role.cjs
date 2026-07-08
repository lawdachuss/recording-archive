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

  const roles = await pool.query("SELECT * FROM user_roles");
  console.log("Roles:", JSON.stringify(roles.rows, null, 2));

  const rls = await pool.query(
    "SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = ANY($1)",
    [["user_roles", "user_profiles"]]
  );
  console.log("RLS:", JSON.stringify(rls.rows, null, 2));

  const policies = await pool.query(
    "SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual FROM pg_policies WHERE tablename = 'user_roles'"
  );
  console.log("Policies:", JSON.stringify(policies.rows, null, 2));

  // Also check the exact user
  const user = await pool.query("SELECT id, email, raw_user_meta_data FROM auth.users WHERE id = $1", [
    "042f11b1-8b0a-4c12-b6cb-091b33e6d64f"
  ]);
  console.log("Our user:", JSON.stringify(user.rows[0], null, 2));

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
