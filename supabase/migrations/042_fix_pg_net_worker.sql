-- Fix pg_net background worker configuration
-- Root cause: pg_net.username was not set, preventing background worker from running
-- This caused database triggers to queue HTTP requests that never got processed

-- Note: This setting must be in postgresql.conf or postgresql.auto.conf
-- For Docker Supabase, add to volumes/db/postgresql.auto.conf:
--   pg_net.username = postgres
--
-- After adding, restart the database container:
--   docker restart supabase-db

-- Verify configuration:
DO $$
BEGIN
  IF current_setting('pg_net.username', true) IS NULL OR current_setting('pg_net.username', true) = '' THEN
    RAISE WARNING 'pg_net.username is not set! Background worker will not process HTTP requests.';
    RAISE WARNING 'Add "pg_net.username = postgres" to postgresql.auto.conf and restart database.';
  ELSE
    RAISE NOTICE 'pg_net.username is set to: %', current_setting('pg_net.username');
    RAISE NOTICE 'Background worker should be running.';
  END IF;
END $$;

-- Test pg_net connectivity (optional - comment out in production)
-- SELECT net.http_get(url := 'https://api.onpointprodoors.com/rest/v1/');
