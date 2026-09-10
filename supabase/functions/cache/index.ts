// Edge cache API — backs the frontend's Tier-0 shared cache
// (artifacts/video-archive/src/lib/cache.ts).
//
//   GET    /cache?key=<key>          → { exists, value?, ttl? } (ttl in seconds)
//   POST   /cache  { key, value, ttl? } → { success }          (ttl in seconds)
//   DELETE /cache?key=<key>          → { success }
//
// The browser calls this cross-origin (https://supabase.chuglii.in), so every
// response carries permissive CORS headers and OPTIONS preflights are answered.
// Values are stored as jsonb with an optional TTL; expired rows are pruned
// lazily on read. Payload size and TTL are capped so a public endpoint can't
// be used to stuff the table.
//
// Deploy (from repo root):
//   supabase functions deploy cache --project-ref <ref> --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// 7 days — matches the frontend's longest TTL (CACHE_TTL.DAY is 24h; this is a
// generous ceiling so callers never hit it accidentally).
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
// Keep payloads small — large values belong in the browser's local tiers.
const MAX_VALUE_BYTES = 200_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  try {
    // ── GET /cache?key=<key> ──────────────────────────────────────────────
    if (req.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "key query parameter required" }, 400);

      const { data, error } = await supabase
        .from("edge_cache")
        .select("value, expires_at")
        .eq("key", key)
        .maybeSingle();

      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ exists: false, value: null, ttl: null });

      const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
      if (expiresAt !== null && expiresAt <= Date.now()) {
        // Expired — prune lazily and report a miss.
        await supabase.from("edge_cache").delete().eq("key", key);
        return json({ exists: false, value: null, ttl: null });
      }

      const ttl = expiresAt === null
        ? null
        : Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      return json({ exists: true, value: data.value, ttl });
    }

    // ── DELETE /cache?key=<key> ───────────────────────────────────────────
    if (req.method === "DELETE") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "key query parameter required" }, 400);

      const { error } = await supabase.from("edge_cache").delete().eq("key", key);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    // ── POST /cache  { key, value, ttl? } ─────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.key !== "string" || body.key.length === 0) {
        return json({ error: "body must be { key, value, ttl? }" }, 400);
      }
      if (body.value === undefined || body.value === null) {
        return json({ error: "value is required" }, 400);
      }

      const rawTtl = Number(body.ttl);
      const ttlSec = Number.isFinite(rawTtl) && rawTtl > 0
        ? Math.max(1, Math.min(MAX_TTL_SECONDS, Math.round(rawTtl)))
        : null;

      const serialized = JSON.stringify(body.value);
      if (serialized.length > MAX_VALUE_BYTES) {
        return json({ error: "value too large" }, 413);
      }

      const expiresAt = ttlSec === null
        ? null
        : new Date(Date.now() + ttlSec * 1000).toISOString();

      const { error } = await supabase
        .from("edge_cache")
        .upsert(
          { key: body.key, value: body.value, expires_at: expiresAt },
          { onConflict: "key" },
        );
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "internal error" },
      500,
    );
  }
});