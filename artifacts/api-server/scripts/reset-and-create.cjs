const { Pool } = require("pg");
const https = require("https");

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

  const USERNAME = "lawdachuss";
  const PASSWORD = process.env.ADMIN_PASSWORD || "BASUDEVK";
  // Use a valid, deliverable-looking email — Supabase rejects fake TLDs like .local.
  const EMAIL = process.env.ADMIN_EMAIL || "lawdachuss@chuglii.in";

  try {
    // Step 1: Get existing auth user IDs before deleting
    const authUsers = await pool.query("SELECT id, email FROM auth.users");
    const allUserIds = authUsers.rows.map((r) => r.id);
    console.log("Existing auth users:", authUsers.rows.length);

    // Step 2: Delete from ALL public tables
    const publicTables = [
      "user_profiles", "user_roles", "saved_videos", "watch_history",
      "watch_later_items", "user_collections", "user_collection_items",
      "performer_follows", "user_notifications", "requests",
      "comments", "comment_likes", "reactions"
    ];

    for (const table of publicTables) {
      try {
        const r = await pool.query("DELETE FROM " + table);
        console.log("Cleared " + table + ": " + r.rowCount + " rows");
      } catch (e) {
        // Table might not exist
      }
    }

    // Step 3: Delete auth users
    if (allUserIds.length > 0) {
      const ids = allUserIds.map((id) => "'" + id + "'").join(",");
      // Try direct deletion from auth schema
      try {
        // First, try Supabase's method - delete identities first
        await pool.query("DELETE FROM auth.identities WHERE user_id IN (" + ids + ")");
        await pool.query("DELETE FROM auth.sessions WHERE user_id IN (" + ids + ")");
        await pool.query("DELETE FROM auth.mfa_factors WHERE user_id IN (" + ids + ")");
        await pool.query("DELETE FROM auth.mfa_challenges WHERE user_id IN (" + ids + ")");
        const d = await pool.query("DELETE FROM auth.users WHERE id IN (" + ids + ")");
        console.log("Deleted auth users: " + d.rowCount);
      } catch (e) {
        console.log("Could not delete auth users directly: " + e.message);
        console.log("Will create new user via Supabase API instead");
      }
    }

    await pool.end();

    // Step 4: Create new user via Supabase Admin API (service role) —
    // email_confirm:true bypasses email verification so the account is
    // immediately usable (the old .local address was rejected by Supabase).
    const supabaseUrl = process.env.SUPABASE_URL || "https://supabase.chuglii.in";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_API_KEY || "";

    console.log("\nCreating new account via Supabase Admin API...");

    const response = await fetch(supabaseUrl + "/auth/v1/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey,
      },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: {
          display_name: USERNAME,
          username: USERNAME,
        },
      }),
    });

    const result = await response.json();
    console.log("Signup response:", JSON.stringify(result, null, 2));

    if (result.error || result.code) {
      console.error("Signup failed:", result.msg || result.error_description || result.error);
      process.exit(1);
    }

    // Step 5: If user was created, make them admin
    if (result.id) {
      const userId = result.id;
      console.log("New user ID:", userId);

      // Reconnect to DB to set admin role
      const pool2 = new Pool({
        host: url.hostname,
        port: Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ""),
        ssl: { rejectUnauthorized: false },
      });

      // Create user profile
      await pool2.query(
        "INSERT INTO user_profiles (user_id, display_name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (user_id) DO UPDATE SET display_name = $2",
        [userId, USERNAME]
      );
      console.log("User profile created");

      // Grant admin
      await pool2.query(
        "INSERT INTO user_roles (user_id, role, created_at) VALUES ($1, 'admin', NOW()) ON CONFLICT (user_id) DO UPDATE SET role = 'admin'",
        [userId]
      );
      console.log("Admin role granted");

      await pool2.end();

      console.log("\n=== DONE ===");
      console.log("Email:    " + EMAIL);
      console.log("Password: " + PASSWORD);
      console.log("Role:     admin");
      console.log("email_confirmed:", result.email_confirmed_at ? "yes" : "no");
    }

  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
