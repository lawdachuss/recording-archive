import type { SupabaseClient } from "@supabase/supabase-js";

// Lazy-load the Supabase SDK (208KB) — defer loading until first access.
// This removes the SDK from the critical rendering path so the Home page
// paints before the heavy auth library finishes downloading.
let _client: SupabaseClient | null = null;
let _loadPromise: Promise<SupabaseClient> | null = null;

function ensureClient(): Promise<SupabaseClient> {
  if (_client) return Promise.resolve(_client);
  if (!_loadPromise) {
    _loadPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => {
        const url =
          (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
          (import.meta.env.SUPABASE_URL as string | undefined) ||
          "";
        const key =
          (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
          (import.meta.env.SUPABASE_ANON_KEY as string | undefined) ||
          "";
        _client = createClient(url, key);
        return _client;
      })
      .catch((err) => {
        // Don't cache a rejected promise — allow a retry on next access
        // instead of leaving an unhandled rejection poisoning all callers.
        _loadPromise = null;
        throw err;
      });
  }
  return _loadPromise;
}

/**
 * Get the lazily-loaded Supabase client. Returns a promise that resolves
 * to the real client on first call, then returns the cached client after.
 *
 * AuthContext should be updated to use:
 *   const client = await getSupabase();
 *   client.auth.getSession()...
 */
export async function getSupabase(): Promise<SupabaseClient> {
  return ensureClient();
}

// Synchronous getter for code that already has the client cached.
// Returns null if the SDK hasn't been loaded yet.
export function getSupabaseSync(): SupabaseClient | null {
  return _client;
}
