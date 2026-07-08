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

  try {
    const userId = "042f11b1-8b0a-4c12-b6cb-091b33e6d64f";

    // Try to confirm email directly in auth schema
    await pool.query(
      "UPDATE auth.users SET email_confirmed_at = NOW(), last_sign_in_at = NOW(), email_change_confirm_status = 0 WHERE id = $1",
      [userId]
    );
    // confirmed_at can only be DEFAULT
    console.log("Email confirmed in auth.users");

    // Also update the identity
    await pool.query(
      "UPDATE auth.identities SET last_sign_in_at = NOW() WHERE id = $1",
      [userId]
    );
    console.log("Identity updated");

    // Verify
    const r = await pool.query("SELECT id, email, email_confirmed_at, confirmed_at FROM auth.users WHERE id = $1", [userId]);
    console.log("User state:", JSON.stringify(r.rows[0], null, 2));

    console.log("\nYou can now sign in at /login with:");
    console.log("  Email:    lawdachuss@admin.local");
    console.log("  Password: BASUDEVK");
    console.log("Then access /admin");
  } catch (err) {
    console.error("Error:", err.message);
  }

  await pool.end();
  process.exit(0);
}

main();
