---
name: Vite Replit secrets as VITE_ vars
description: How to expose Replit secrets (non-VITE_ prefixed) to Vite client-side code without duplicating them
---

## The rule
Add `envPrefix: ["VITE_", "SUPABASE_"]` (or whatever prefix your secrets use) to `vite.config.ts`, then update the consuming code to try `import.meta.env.VITE_X` first and fall back to `import.meta.env.X`. After changing `vite.config.ts` you MUST do a full workflow restart — HMR does not pick up `envPrefix` changes.

**Why:** Replit secrets are stored as `SUPABASE_URL` / `SUPABASE_ANON_KEY` (no VITE_ prefix). Vite only exposes env vars that match `envPrefix` to client-side `import.meta.env`. Without `envPrefix: ["SUPABASE_"]`, those values are empty strings in the browser, causing the `supabaseUrl is required` crash from `@supabase/supabase-js`.

**How to apply:** Any time a Replit secret needs to reach frontend code: (1) add its prefix to `envPrefix` in `vite.config.ts`, (2) update `src/lib/supabase.ts` (or wherever) to read `import.meta.env.SUPABASE_URL`, (3) restart the "Start application" workflow (not just HMR). The VITE_ variants are optional but can co-exist for deployment environments that do set them.
