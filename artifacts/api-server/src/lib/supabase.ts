import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
// Use service_role key for backend operations (bypasses RLS),
// fall back to anon key if service_role is not available.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY are required",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Creates a Supabase client authenticated as a specific user.
 * Use this in authenticated route handlers so RLS policies see
 * the correct `auth.uid()` — without this, the global anon-key
 * client makes RLS treat every request as unauthenticated.
 */
export function createUserClient(token: string): SupabaseClient {
  return createClient(supabaseUrl!, supabaseKey!, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Fetch every row of a query, paginating past PostgREST's default
 * 1,000-row cap. The `build` callback receives the inclusive range
 * (start, end) for the current page and must return a `.range()`
 * supabase-js query builder. Returns the same `{ data, error }` shape
 * as a normal supabase-js call so callers can keep their error handling.
 */
export async function fetchAll<T>(
  build: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<{ data: T[] | null; error: unknown }> {
  const all: T[] = [];
  let start = 0;
  for (;;) {
    const { data, error } = await build(start, start + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    start += pageSize;
  }
  return { data: all, error: null };
}
