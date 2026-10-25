-- Turn on row level security for every table in the public schema.
--
-- Why: on Supabase, tables in "public" are also reachable through Supabase's
-- automatic Data API (PostgREST) with the project's public "anon" key. With
-- RLS on and no policies, that API returns nothing, so customer, order and
-- admin data can only be read through our own server.
--
-- Our server is not affected: it connects as the role that owns these tables
-- (postgres on Supabase and Railway), and a table's owner is not restricted by
-- RLS unless FORCE is set, which we never do. On a plain Postgres host this is
-- harmless.
--
-- New tables added by later migrations must include
--   ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
