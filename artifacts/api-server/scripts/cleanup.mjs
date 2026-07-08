import { Pool } from "pg";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL not set");

const url = new URL(dbUrl);
const pool = new Pool({
  host: url.hostname,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  // Find lawdachuss user IDs from auth.users
  const authUsers = await pool.query(
    "SELECT id, email, raw_user_meta_data FROM auth.users"
  );

  const lawdachussIds = authUsers.rows
    .filter((u) => {
      const meta = u.raw_user_meta_data;
      return (
        meta?.display_name?.toLowerCase() === "lawdachuss" ||
        meta?.username?.toLowerCase() === "lawdachuss"
      );
    })
    .map((u) => u.id);

  console.log("Lawdachuss user IDs:", lawdachussIds);

  // Keep these and the existing admin 'test' user
  const existingAdminId = "ecc1abd2-a31a-4556-9476-2a0c48658848";
  const keepIds = [...lawdachussIds, existingAdminId];

  // Make all lawdachuss users admin
  for (const uid of lawdachussIds) {
    await pool.query(
      "INSERT INTO user_roles (user_id, role, created_at) VALUES ($1, 'admin', NOW()) ON CONFLICT (user_id) DO UPDATE SET role = 'admin'",
      [uid]
    );
    console.log(`Admin granted: ${uid}`);
  }

  // Delete non-kept user_profiles
  if (keepIds.length > 0) {
    const placeholders = keepIds.map((_, i) => `$${i + 1}`).join(",");
    const deletedProfiles = await pool.query(
      `DELETE FROM user_profiles WHERE user_id NOT IN (${placeholders}) RETURNING user_id`,
      keepIds
    );
    console.log(`Deleted ${deletedProfiles.rowCount} user_profiles`);

    const deletedRoles = await pool.query(
      `DELETE FROM user_roles WHERE user_id NOT IN (${placeholders}) RETURNING user_id`,
      keepIds
    );
    console.log(`Deleted ${deletedRoles.rowCount} user_roles`);

    // Also clean up related data
    for (const table of ["saved_videos", "watch_history", "watch_later_items", "user_collections", "performer_follows", "user_notifications", "requests"]) {
      const r = await pool.query(
        `DELETE FROM ${table} WHERE user_id NOT IN (${placeholders})`,
        keepIds
      );
      if (r.rowCount > 0) console.log(`Cleaned ${r.rowCount} rows from ${table}`);
    }
  }

  console.log("\nDone. Lawdachuss is now admin.");
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
