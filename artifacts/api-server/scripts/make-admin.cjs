const { Pool } = require("pg");

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/make-admin.cjs <user_id>");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const url = new URL(dbUrl);
  const pool = new Pool({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query(
      "INSERT INTO user_roles (user_id, role, created_at) VALUES ($1, 'admin', NOW()) ON CONFLICT (user_id) DO UPDATE SET role = 'admin' RETURNING user_id, role",
      [target]
    );
    console.log("Success:", JSON.stringify(result.rows[0]));
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }

  await pool.end();
  process.exit(0);
}

main();
