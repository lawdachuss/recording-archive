/**
 * Migration: Add sound_enabled and vibration_enabled to user_profiles
 *
 * Run: DATABASE_URL="postgresql://..." node scripts/add-sound-vibration-prefs.cjs
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
    console.log("⏳ Adding sound_enabled and vibration_enabled to user_profiles...");

    await client.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT true;
    `);
    console.log("✅ Column sound_enabled added (default: true)");

    await client.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS vibration_enabled BOOLEAN NOT NULL DEFAULT true;
    `);
    console.log("✅ Column vibration_enabled added (default: true)");

    console.log("\n✅ Migration complete!");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
