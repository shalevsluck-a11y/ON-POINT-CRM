-- ========================================
-- PRODUCTION TRIGGER DIAGNOSTIC
-- Run this in Supabase SQL Editor for production database
-- ========================================

-- STEP 1: Check pg_net extension
SELECT '=== STEP 1: Check pg_net extension ===' AS step;
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
    THEN '✅ pg_net IS installed (version: ' || extversion || ')'
    ELSE '❌ pg_net NOT installed'
  END AS pg_net_status
FROM pg_extension
WHERE extname = 'pg_net';

-- STEP 2: Check trigger exists and is enabled
SELECT '=== STEP 2: Check triggers on jobs table ===' AS step;
SELECT
  t.tgname AS trigger_name,
  p.proname AS function_name,
  CASE t.tgenabled
    WHEN 'O' THEN '✅ ENABLED'
    WHEN 'D' THEN '❌ DISABLED'
    ELSE 'UNKNOWN'
  END AS status
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'jobs'::regclass
  AND t.tgname = 'on_job_added';

-- STEP 3: Check app_config has required values
SELECT '=== STEP 3: Check app_config ===' AS step;
SELECT
  key,
  CASE
    WHEN value IS NULL THEN '❌ NULL'
    WHEN value = '' THEN '❌ EMPTY'
    WHEN key = 'service_role_key' THEN '✅ SET (hidden)'
    ELSE '✅ ' || value
  END AS value_status
FROM app_config
WHERE key IN ('supabase_url', 'service_role_key');

-- STEP 4: Test the trigger logic manually
SELECT '=== STEP 4: Manual trigger logic test ===' AS step;
DO $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
  test_job_id TEXT := 'DIAGNOSTIC_TEST_' || floor(random() * 10000)::text;
  http_request_id BIGINT;
BEGIN
  -- Get config (same as trigger does)
  SELECT value INTO supabase_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO service_role_key FROM app_config WHERE key = 'service_role_key';

  RAISE NOTICE '✅ Config loaded:';
  RAISE NOTICE '   supabase_url: %', supabase_url;
  RAISE NOTICE '   service_role_key: % chars', length(service_role_key);

  -- Check if config is valid
  IF supabase_url IS NULL THEN
    RAISE EXCEPTION '❌ supabase_url is NULL in app_config';
  END IF;

  IF service_role_key IS NULL THEN
    RAISE EXCEPTION '❌ service_role_key is NULL in app_config';
  END IF;

  -- Try to call edge function (same as trigger does)
  RAISE NOTICE '✅ Attempting HTTP POST to edge function...';
  RAISE NOTICE '   URL: %', supabase_url || '/functions/v1/send-push';

  SELECT request_id INTO http_request_id
  FROM net.http_post(
    url := supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object(
      'broadcast', true,
      'roles', jsonb_build_array('admin', 'dispatcher'),
      'excludedUserId', '8b2d9042-501e-408d-b260-64e0b08a555f',
      'title', 'DIAGNOSTIC TEST',
      'body', 'If you see this notification, the trigger is working!',
      'jobId', test_job_id
    )
  );

  RAISE NOTICE '✅ HTTP request queued! Request ID: %', http_request_id;
  RAISE NOTICE '   Check edge function logs for invocation';
  RAISE NOTICE '   Check iPhone for notification';

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '❌ FAILED: %', SQLERRM;
    RAISE NOTICE '   Error detail: %', SQLSTATE;
    RAISE NOTICE '   This is WHY the trigger is not sending notifications!';
END $$;

-- STEP 5: Check pg_net queue for pending requests
SELECT '=== STEP 5: Check pg_net request queue ===' AS step;
SELECT
  id,
  created,
  status,
  substring(url from 1 for 50) AS url_preview,
  substring(error_msg from 1 for 100) AS error_preview
FROM net.http_request_queue
ORDER BY created DESC
LIMIT 10;

-- STEP 6: List recent test jobs (to verify they were created)
SELECT '=== STEP 6: Recent test jobs ===' AS step;
SELECT
  job_id,
  customer_name,
  created_by,
  created_at
FROM jobs
WHERE job_id LIKE 'moc%' OR job_id LIKE 'DIAGNOSTIC_%'
ORDER BY created_at DESC
LIMIT 5;
