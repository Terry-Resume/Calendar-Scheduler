-- 016: lock the database to the server.
--
-- All Supabase access in this app happens in server code (route handlers and server
-- components) using the service-role key, which bypasses row-level security.
--
-- Earlier migrations ran `GRANT ALL ... TO anon, authenticated` and
-- `DISABLE ROW LEVEL SECURITY`. Combined with the anon key being shipped to browsers
-- as NEXT_PUBLIC_SUPABASE_ANON_KEY, every table (including the Google OAuth tokens
-- stored on `profiles`) was readable and writable by anyone who opened the site.
--
-- ORDER OF OPERATIONS: deploy the code that reads SUPABASE_SERVICE_ROLE_KEY first,
-- then run this migration. Running it earlier will break the live app, which still
-- uses the anon key.
--
-- Idempotent. Covers tables created outside tracked migrations as well, because it
-- loops over everything in the public schema.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Future tables stay closed by default; a new migration must grant access explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Verification: this must return zero rows.
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
