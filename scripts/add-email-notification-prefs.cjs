/**
 * Migration: Add email_enabled column to user_notification_preferences
 *
 * Run: DATABASE_URL="postgresql://..." node scripts/add-email-notification-prefs.cjs
 *
 * This adds an email_enabled boolean column (default false) so users can
 * separately opt in/out of email notifications per notification type.
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
    console.log("⏳ Adding email_enabled column to user_notification_preferences...");

    // Add the column if it doesn't already exist (idempotent)
    await client.query(`
      ALTER TABLE user_notification_preferences
      ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log("✅ Column email_enabled added successfully (default: false)");

    // Verify
    const { rows } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'user_notification_preferences'
        AND column_name = 'email_enabled'
    `);
    if (rows.length > 0) {
      console.log(`  ✓ Verified: ${rows[0].column_name} (${rows[0].data_type}, default: ${rows[0].column_default})`);
    } else {
      console.log("  ⚠️ Column not found after migration");
    }

    console.log("\n✅ Migration complete!");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
