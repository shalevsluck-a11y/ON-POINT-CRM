-- DIAGNOSTIC AND FIX SCRIPT FOR PUSH NOTIFICATION TRIGGERS
-- Run this in Supabase SQL Editor to diagnose and fix the issue

-- Step 1: Check if app_config table exists and has values
DO $$
DECLARE
  config_count INTEGER;
  url_value TEXT;
  key_value TEXT;
BEGIN
  SELECT COUNT(*) INTO config_count FROM app_config;
  SELECT value INTO url_value FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO key_value FROM app_config WHERE key = 'service_role_key';

  RAISE NOTICE 'App config rows: %', config_count;
  RAISE NOTICE 'Supabase URL configured: %', (url_value IS NOT NULL AND url_value != '');
  RAISE NOTICE 'Service role key configured: %', (key_value IS NOT NULL AND key_value != '');

  IF url_value IS NULL OR url_value = '' THEN
    RAISE WARNING 'PROBLEM: supabase_url is not configured in app_config table!';
  END IF;

  IF key_value IS NULL OR key_value = '' THEN
    RAISE WARNING 'PROBLEM: service_role_key is not configured in app_config table!';
  END IF;
END $$;

-- Step 2: Check if triggers exist
SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'jobs'
  AND trigger_name IN ('on_job_added', 'on_job_closed', 'on_job_assigned', 'on_job_closed_set_user')
ORDER BY trigger_name;

-- Step 3: Check if trigger functions exist
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name IN ('notify_job_added', 'notify_job_closed', 'notify_job_assigned', 'set_closed_by')
  AND routine_schema = 'public'
ORDER BY routine_name;

-- Step 4: Ensure app_config has correct values (if missing)
INSERT INTO app_config (key, value) VALUES
  ('supabase_url', 'https://nmmpemjcnncjfpooytpv.supabase.co'),
  ('service_role_key', '***REDACTED-SUPABASE-SERVICE-KEY-2***')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Step 5: Ensure triggers are attached (run 037 migration manually if needed)
-- This ensures the triggers use the latest function definitions
DROP TRIGGER IF EXISTS on_job_added ON jobs;
CREATE TRIGGER on_job_added
  AFTER INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_added();

DROP TRIGGER IF EXISTS on_job_closed ON jobs;
CREATE TRIGGER on_job_closed
  AFTER UPDATE ON jobs
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed'))
  EXECUTE FUNCTION notify_job_closed();

-- Verify triggers are now attached
SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'jobs'
  AND trigger_name IN ('on_job_added', 'on_job_closed')
ORDER BY trigger_name;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✓ Diagnostic complete. Triggers should now fire on job INSERT and status=closed UPDATE.';
  RAISE NOTICE '✓ Test by creating a new job - check if push notifications are sent.';
END $$;
