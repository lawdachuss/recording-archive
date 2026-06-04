# Video Archive

A modern, dark-themed video archive site for Chaturbate recordings, backed by an existing Supabase database.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/video-archive run dev` — run the frontend (port 18784)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS v4, shadcn/ui, wouter, TanStack Query
- API: Express 5 + Supabase JS client (proxying existing Supabase DB)
- DB: Existing Supabase PostgreSQL (no Replit-managed DB)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas for server validation (do not edit)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/supabase.ts` — Supabase client singleton
- `artifacts/video-archive/src/pages/` — Frontend pages
- `artifacts/video-archive/src/components/` — Shared components

## Architecture decisions

- The API server acts as a thin proxy/aggregation layer in front of Supabase — all data comes from Supabase, but the frontend only talks to `/api/*`
- No Replit-managed database is used; `DATABASE_URL` is not needed
- The `recordings` table in Supabase is the sole data source (171+ recordings, 35+ performers)
- Dark mode is forced globally via `document.documentElement.classList.add("dark")` in `main.tsx`
- Age verification is gated via `localStorage` on first visit

## Product

- **Home** — Stats banner, hero search, recent recordings grid, top performers, popular tags
- **Browse** — Search + filter (gender, resolution, tags, sort), paginated video grid
- **Video Detail** — Embedded iframe player, metadata, related videos sidebar
- **Performers** — Grid of all performers with recording counts
- **Performer Profile** — Per-performer recording grid
- **Tags** — Tag cloud with counts, clickable to filter browse

## Supabase schema (recordings table)

Fields: `id`, `username`, `filename`, `timestamp`, `room_title`, `tags[]`, `viewers`, `resolution`, `framerate`, `filesize`, `gender`, `thumbnail_url`, `sprite_url`, `embed_url`, `preview_url`, `instance_id`, `created_at`, `updated_at`

## Environment variables

- `SUPABASE_URL` — Supabase project URL (shared)
- `SUPABASE_ANON_KEY` — Supabase anon key (shared)
- `VITE_SUPABASE_URL` — Same URL, exposed to frontend (shared)
- `VITE_SUPABASE_ANON_KEY` — Same anon key, exposed to frontend (shared)

## Gotchas

- After any OpenAPI spec change, always run codegen before touching frontend or backend code
- The `recordings/related` endpoint uses a query param `?id=` (not a path param) to avoid Orval naming collisions
- Body schemas in openapi.yaml must use entity-shaped names (not operation-shaped) to avoid TS2308 collisions
- Tailwind v4: `@apply dark` in CSS does not work — use `document.documentElement.classList.add("dark")` in JS instead
- Deep imports like `@workspace/api-client-react/src/generated/api.schemas` break Vite — always import from the barrel: `@workspace/api-client-react`

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
