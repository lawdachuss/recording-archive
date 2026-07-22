/**
 * Migration: Create user_notification_preferences table
 *
 * Run: DATABASE_URL="postgresql://..." node scripts/setup-notification-preferences.cjs
 *
 * This table allows users to opt in/out of specific notification types.
 * By default, all notification types are enabled (no row = enabled).
 */
const { Client } = require("pg");

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    console.log("⏳ Creating user_notification_preferences table...");

    const result = await client.query(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        notification_type VARCHAR(50) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, notification_type)
      );
    `);
    console.log("✅ Table created successfully");

    // Index for fast lookups when creating notifications
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
        ON user_notification_preferences(user_id);
    `);
    console.log("✅ Index created successfully");

    // Verify by counting rows
    const { rows } = await client.query(
      "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'user_notification_preferences'"
    );
    if (rows[0].cnt > 0) {
      console.log("✅ Verification passed — table exists");
    } else {
      console.log("⚠️ Table may not exist — please verify manually");
    }
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
