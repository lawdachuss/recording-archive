-- Ensure collection-item upserts can infer the (collection_id, recording_id) conflict target.
-- Keep the earliest row for any historical duplicate pair before enforcing uniqueness.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY collection_id, recording_id
      ORDER BY added_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.user_collection_items
)
DELETE FROM public.user_collection_items AS items
USING ranked
WHERE items.ctid = ranked.ctid
  AND ranked.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_collection_items'::regclass
      AND conname = 'user_collection_items_collection_recording_unique'
  ) THEN
    ALTER TABLE public.user_collection_items
      ADD CONSTRAINT user_collection_items_collection_recording_unique
      UNIQUE (collection_id, recording_id);
  END IF;
END $$;
