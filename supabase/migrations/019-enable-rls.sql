-- Enable row-level security on application tables.
-- Public recording metadata and upload links are intentionally readable;
-- user-scoped tables are restricted to rows owned by auth.uid().
-- Tables without an explicit safe policy remain default-deny for API roles.
BEGIN;

DO $$
DECLARE
  t record;
  has_user_id boolean;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('spatial_ref_sys')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);

    -- Idempotently allow public read-only access to the recording catalogue.
    IF t.relname IN ('recordings', 'upload_links') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        'public_read_' || t.relname, t.relname);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
        'public_read_' || t.relname, t.relname
      );
    END IF;

    -- Standard owner policy for user-scoped tables. Never grant ownership
    -- based on client-supplied claims other than the verified auth.uid().
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t.relname
        AND column_name = 'user_id'
    ) INTO has_user_id;

    IF has_user_id THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
        'user_owns_rows', t.relname);
      EXECUTE format(
        'CREATE POLICY user_owns_rows ON public.%I FOR ALL TO authenticated USING (user_id::text = (SELECT auth.uid())::text) WITH CHECK (user_id::text = (SELECT auth.uid())::text)',
        t.relname
      );
    END IF;
  END LOOP;
END
$$;

-- Make sure the API roles can read the intended public catalogue; RLS still
-- applies to these grants and writes remain service-role-only unless separately
-- granted by a deliberate policy.
DO $
BEGIN
  IF to_regclass('public.recordings') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.recordings TO anon, authenticated;
  END IF;
  IF to_regclass('public.upload_links') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.upload_links TO anon, authenticated;
  END IF;
END
$;

COMMIT;

NOTIFY pgrst, 'reload schema';
