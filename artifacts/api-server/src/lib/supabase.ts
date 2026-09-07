import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// These are also loaded from env vars at runtime.
// Fall back to hardcoded values if env vars are not set (e.g. Vercel propagation delay).
const supabaseUrl = process.env.SUPABASE_URL || "https://supabase.chuglii.in";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTcwMDAwMDAwMCwgImV4cCI6IDIwMTUzNjAwMDB9.UTDwoY0L6W6nllK7FvssoFLp3qvAx60PijJyL9XHyXQ";

let _supabase: SupabaseClient | null = null;

function getSupabaseSync(): SupabaseClient {
  if (_supabase) return _supabase;
  try {
    _supabase = createClient(supabaseUrl, supabaseKey);
    return _supabase;
  } catch (err) {
    throw new Error(`Supabase client creation failed: ${String(err)}`);
  }
}

// Proxy that forwards property access to the lazy-loaded client.
// Supports both `supabase.from(...)` and calling it first.
const supabaseProxy = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseSync();
    return (client as any)[prop];
  },
});

export { supabaseProxy as supabase };
export type SupabaseClientType = typeof supabaseProxy;

/**
 * Refresh the Supabase schema cache by creating a new client.
 * Call this when PostgREST returns PGRST205 (table not in schema cache).
 */
export function refreshSupabaseSchema(): SupabaseClient {
  _supabase = null;
  return getSupabaseSync();
}

/**
 * Creates a Supabase client authenticated as a specific user.
 * Use this in authenticated route handlers so RLS policies see
 * the correct `auth.uid()` — without this, the global anon-key
 * client makes RLS treat every request as unauthenticated.
 */
export function createUserClient(token: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseKey, {
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
