import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Supabase database host (db.*.supabase.co) is IPv6-only.
// Vercel serverless and most corporate networks are IPv4-only, so we must use
// the Supavisor connection pooler with SSL enabled.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { sql } from "drizzle-orm";
