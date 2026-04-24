-- Temporary diagnostic function to check trigger status
-- Run this in Supabase SQL Editor for production database

-- Check if pg_net extension exists
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
    THEN '✅ pg_net extension IS installed (version: ' || extversion || ')'
    ELSE '❌ pg_net extension NOT installed - triggers CANNOT call HTTP endpoints'
  END AS pg_net_status,
  extversion
FROM pg_extension
WHERE extname = 'pg_net'
UNION ALL
SELECT '❌ pg_net extension NOT installed - triggers CANNOT call HTTP endpoints', NULL
WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net');

-- Check triggers on jobs table
SELECT
  '=== TRIGGERS ON jobs TABLE ===' AS info,
  NULL AS detail
UNION ALL
SELECT
  tgname || ' → ' || p.proname AS trigger_info,
  CASE t.tgenabled
    WHEN 'O' THEN '✅ ENABLED'
    WHEN 'D' THEN '❌ DISABLED'
    ELSE 'UNKNOWN: ' || t.tgenabled
  END AS status
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'jobs'::regclass
  AND NOT t.tgisinternal;

-- Check if notify_job_added function exists
SELECT
  '=== notify_job_added() FUNCTION ===' AS info,
  NULL AS detail
UNION ALL
SELECT
  'Function: ' || p.proname AS info,
  'Language: ' || l.lanname AS detail
FROM pg_proc p
JOIN pg_language l ON p.prolang = l.oid
WHERE p.proname = 'notify_job_added'
UNION ALL
SELECT
  '❌ notify_job_added() function NOT found',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_job_added');

-- Check app_config for edge function URL
SELECT
  '=== APP CONFIG (for edge function calls) ===' AS info,
  NULL AS detail
UNION ALL
SELECT
  key AS info,
  CASE
    WHEN key = 'service_role_key' THEN substring(value from 1 for 20) || '...'
    ELSE value
  END AS detail
FROM app_config
WHERE key IN ('supabase_url', 'service_role_key');
