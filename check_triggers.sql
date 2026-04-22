-- Check all triggers on jobs table
SELECT 
  tgname as trigger_name,
  tgenabled as enabled,
  pg_get_triggerdef(oid) as definition
FROM pg_trigger
WHERE tgrelid = 'jobs'::regclass
  AND NOT tgisinternal
ORDER BY tgname;
