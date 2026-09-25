-- 013-collection-item-position.sql — stable ordering for collection items.
--
-- Until now user_collection_items had no explicit order: items were shown by
-- added_at DESC (newest first) and "Play all" played that implicit order.
-- Playlists (the Spotify/YouTube model) need a user-controlled order that
-- survives add/remove, so items get a `position` integer (0-based, dense).
--
-- Schema reality (verified via pg_catalog before writing this): ids and
-- user_id are TEXT, user_collection_items.id is an integer, and RLS is
-- already enforced by the existing uci_*_own policies — including
-- uci_update_own, which this migration relies on for direct updates.
--
-- Rules kept simple and race-tolerant:
--   - new items append after the current max (min + count, safe even if
--     historical gaps leave max not dense)
--   - reorder renumbers the whole collection in one RPC call (atomic, and
--     the client never sends per-row updates)

-- ── 1. Column ────────────────────────────────────────────────────────────
alter table public.user_collection_items
  add column if not exists position integer;

-- ── 2. Backfill: order by added_at, then id (deterministic tiebreak) ────
with ranked as (
  select id, row_number() over (
           partition by collection_id
           order by added_at asc, id asc
         ) - 1 as pos
  from public.user_collection_items
)
update public.user_collection_items u
set position = ranked.pos
from ranked
where u.id = ranked.id
  and (u.position is distinct from ranked.pos);

-- ── 3. Append-on-insert trigger ──────────────────────────────────────────
create or replace function public.user_collection_items_set_position()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base integer;
begin
  select coalesce(min(position), 0) + count(*)::int
    into base
  from public.user_collection_items
  where collection_id = new.collection_id;
  new.position := base;
  return new;
end;
$$;

drop trigger if exists trg_collection_item_position
  on public.user_collection_items;
create trigger trg_collection_item_position
  before insert on public.user_collection_items
  for each row execute function public.user_collection_items_set_position();

-- ── 4. Reorder RPC (atomic whole-collection renumber) ───────────────────
-- One statement = one snapshot: N per-row updates from the API would be
-- non-atomic over PostgREST (interleaved reads would see torn orders).
-- Rows missing from the payload keep their position (partial reorders OK);
-- the normal client sends every id, so renumbering is dense.
create or replace function public.reorder_collection_items(
  p_collection_id text,
  p_recording_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user text;
  v_caller text;
  v_updated integer := 0;
  rec record;
begin
  v_caller := (auth.uid())::text;
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select user_id into v_user
  from public.user_collections
  where id = p_collection_id;
  if v_user is null then
    raise exception 'collection not found';
  end if;
  if v_user <> v_caller then
    raise exception 'not permitted';
  end if;

  if p_recording_ids is null or cardinality(p_recording_ids) = 0 then
    raise exception 'recording_ids required';
  end if;

  -- Duplicate ids would make the renumber ambiguous — reject loudly.
  if exists (
    select 1 from unnest(p_recording_ids) x
    group by x
    having count(*) > 1
  ) then
    raise exception 'duplicate recording ids in payload';
  end if;

  -- Renumber the payload rows by their array index (0-based).
  for rec in
    select i, x from unnest(p_recording_ids) with ordinality as t(x, i)
  loop
    update public.user_collection_items
       set position = rec.i - 1
     where collection_id = p_collection_id
       and recording_id = rec.x;
    v_updated := v_updated + 1;
  end loop;

  -- Keep metadata fresh for the collections list view.
  update public.user_collections
     set updated_at = now()
   where id = p_collection_id;

  return v_updated;
end;
$$;

grant execute on function public.reorder_collection_items(text, text[]) to authenticated;
