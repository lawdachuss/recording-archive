const { db, sql } = require("@workspace/db");

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/make-admin.cjs <user_id_or_username>");
  process.exit(1);
}

async function main() {
  // Check if target is a user_id (uuid-like) or a username
  const isUuid = /^[0-9a-f-]{36}$/i.test(target);

  if (isUuid) {
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role, created_at)
      VALUES (${target}, 'admin', NOW())
      ON CONFLICT (user_id) DO UPDATE SET role = 'admin'
    `);
    console.log(`User ${target} is now an admin.`);
  } else {
    // Look up by username
    const result = await db.execute(sql`
      SELECT user_id FROM user_profiles
      WHERE username = ${target} OR display_name ILIKE ${target}
      LIMIT 1
    `);
    if (result.rows.length === 0) {
      console.error(`No user found with username/display name: ${target}`);
      process.exit(1);
    }
    const userId = result.rows[0].user_id;
    await db.execute(sql`
      INSERT INTO user_roles (user_id, role, created_at)
      VALUES (${userId}, 'admin', NOW())
      ON CONFLICT (user_id) DO UPDATE SET role = 'admin'
    `);
    console.log(`User "${target}" (${userId}) is now an admin.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
