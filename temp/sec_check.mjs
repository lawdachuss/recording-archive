import pg from "pg";
const p = new pg.Pool({ connectionString: "postgresql://postgres.rvbuzyljrwsxfxijotdf:Basudevkr123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres", ssl: { rejectUnauthorized: false } });
(async () => {
  // 1. Tables with RLS disabled
  const rls = await p.query(`
    SELECT c.relname AS table
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
    ORDER BY c.relname`);
  console.log("=== Tables WITHOUT RLS (rowsecurity=false) ===");
  console.log(rls.rows.length ? rls.rows.map(r => r.table).join("\n") : "(none)");

  // 2. Tables with no policies at all (RLS on but unprotected -> blocks all)
  const noPol = await p.query(`
    SELECT c.relname AS table
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid=c.oid)
    ORDER BY c.relname`);
  console.log("\n=== RLS-enabled tables with NO policies (blocks all access) ===");
  console.log(noPol.rows.length ? noPol.rows.map(r => r.table).join("\n") : "(none)");

  // 3. Auth schema / role grants (public role can read auth?)
  const grants = await p.query(`
    SELECT n.nspname AS schema, c.relname AS table, array_agg(privilege_type::text) AS privs
    FROM information_schema.role_table_grants g
    JOIN pg_class c ON c.relname=g.table_name
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE g.grantee='anon' OR g.grantee='authenticated'
    GROUP BY n.nspname, c.relname
    ORDER BY n.nspname, c.relname`);
  console.log("\n=== Direct grants to anon/authenticated on auth.* or other schemas ===");
  console.log(grants.rows.length ? grants.rows.map(r => `${r.schema}.${r.table}: ${r.privs}`).join("\n") : "(none)");

  // 4. Auth users table exposed?
  const authUsers = await p.query(`
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='auth' AND table_name='users'
    AND (grantee='anon' OR grantee='authenticated')`);
  console.log("\n=== Grants on auth.users to anon/authenticated ===");
  console.log(authUsers.rows.length ? authUsers.rows.map(r => `${r.grantee}: ${r.privilege_type}`).join("\n") : "(none)");

  await p.end();
})().catch(e => { console.log("FAIL", e.message); process.exit(1); });
