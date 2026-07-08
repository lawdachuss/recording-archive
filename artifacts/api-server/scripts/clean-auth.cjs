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

  const keepId = "042f11b1-8b0a-4c12-b6cb-091b33e6d64f";

  try {
    // Get all stale user IDs
    const stale = await pool.query("SELECT id, email FROM auth.users WHERE id != $1", [keepId]);
    console.log("Stale auth users:", stale.rows.length);

    const tables = [
      "auth.mfa_factors",
      "auth.mfa_challenges",
      "auth.sessions",
      "auth.refresh_tokens",
      "auth.identities",
    ];

    for (const row of stale.rows) {
      const id = row.id;
      console.log("Deleting:", id, row.email);

      for (const table of tables) {
        try {
          // Check if the column exists first
          const colCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'user_id'",
            [table.split(".")[0], table.split(".")[1]]
          );
          const colName = colCheck.rows.length > 0 ? "user_id" : "id";
          await pool.query("DELETE FROM " + table + " WHERE " + colName + " = $1", [id]);
        } catch (e) {
          console.log("  Could not delete from " + table + ": " + e.message);
        }
      }

      try {
        await pool.query("DELETE FROM auth.users WHERE id = $1", [id]);
        console.log("  Deleted");
      } catch (e) {
        console.log("  Could not delete auth.users: " + e.message);
      }
    }

    // Verify
    const remaining = await pool.query("SELECT id, email FROM auth.users");
    console.log("\nRemaining auth users:", remaining.rows.length);
    for (const r of remaining.rows) {
      console.log("  " + r.id + " | " + r.email);
    }

    // Now update the function to return our user
    await pool.query("SELECT resolve_username($1)", ["lawdachuss"]);
    const test = await pool.query("SELECT resolve_username('lawdachuss') AS email");
    console.log("\nUsername lookup test:", test.rows[0].email);

  } catch (err) {
    console.error("Error:", err.message);
  }

  await pool.end();
  process.exit(0);
}

main();
