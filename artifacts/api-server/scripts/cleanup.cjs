const { Pool } = require("pg");

async function main() {
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
    // Find lawdachuss user IDs from auth.users
    const authResult = await pool.query(
      "SELECT id, email, raw_user_meta_data FROM auth.users"
    );

    const lawdachussIds = authResult.rows
      .filter((u) => {
        const meta = u.raw_user_meta_data;
        return (
          (meta && meta.display_name && meta.display_name.toLowerCase() === "lawdachuss") ||
          (meta && meta.username && meta.username.toLowerCase() === "lawdachuss")
        );
      })
      .map((u) => u.id);

    console.log("Found lawdachuss user IDs:", lawdachussIds);

    // Keep these + the existing admin 'test' user
    const existingAdminId = "ecc1abd2-a31a-4556-9476-2a0c48658848";
    const keepIds = [...lawdachussIds, existingAdminId].filter(Boolean);

    // Make all lawdachuss users admin
    for (const uid of lawdachussIds) {
      await pool.query(
        "INSERT INTO user_roles (user_id, role, created_at) VALUES ($1, 'admin', NOW()) ON CONFLICT (user_id) DO UPDATE SET role = 'admin'",
        [uid]
      );
      console.log("Admin granted:", uid);
    }

    if (keepIds.length > 0) {
      const placeholders = keepIds.map((_, i) => "$" + (i + 1)).join(",");

      for (const table of ["user_profiles", "user_roles", "saved_videos", "watch_history", "watch_later_items", "user_collections", "performer_follows", "user_notifications", "requests"]) {
        const result = await pool.query(
          "DELETE FROM " + table + " WHERE user_id NOT IN (" + placeholders + ")",
          keepIds
        );
        if (result.rowCount > 0) {
          console.log("Cleaned " + result.rowCount + " rows from " + table);
        }
      }
    }

    console.log("\nDone. All lawdachuss accounts are admin. Other users cleaned up.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }

  await pool.end();
  process.exit(0);
}

main();
