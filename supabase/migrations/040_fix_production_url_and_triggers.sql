-- FIX PRODUCTION DATABASE URL AND ENSURE TRIGGERS FIRE
-- Migration 038 had the WRONG URL (nmmpemjcnncjfpooytpv.supabase.co)
-- Production uses api.onpointprodoors.com

-- Step 1: Update app_config with CORRECT production URL
INSERT INTO app_config (key, value) VALUES
  ('supabase_url', 'https://api.onpointprodoors.com'),
  ('service_role_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjY4OTc3MiwiZXhwIjoyMDkyMjY1NzcyfQ.2YtvB-qcKyEPxmYRKzWcpK9f-vUZ5TFgRKGe0oJ_PZA')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Step 2: Verify pg_net extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 3: Re-create trigger functions (from migration 037)
CREATE OR REPLACE FUNCTION notify_job_added()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Get configuration from table
  BEGIN
    SELECT value INTO supabase_url FROM app_config WHERE key = 'supabase_url';
    SELECT value INTO service_role_key FROM app_config WHERE key = 'service_role_key';
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  -- Only proceed if settings are configured
  IF supabase_url IS NOT NULL AND service_role_key IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_role_key
        ),
        body := jsonb_build_object(
          'broadcast', true,
          'roles', jsonb_build_array('admin', 'dispatcher'),
          'excludedUserId', NEW.created_by,
          'title', 'New Job Added',
          'body', 'Job #' || NEW.job_id || ' - ' || COALESCE(NEW.customer_name, 'Customer'),
          'jobId', NEW.job_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to send push notification for job %: %', NEW.job_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_job_closed()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    BEGIN
      SELECT value INTO supabase_url FROM app_config WHERE key = 'supabase_url';
      SELECT value INTO service_role_key FROM app_config WHERE key = 'service_role_key';
    EXCEPTION WHEN OTHERS THEN
      RETURN NEW;
    END;

    IF supabase_url IS NOT NULL AND service_role_key IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url := supabase_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_role_key
          ),
          body := jsonb_build_object(
            'broadcast', true,
            'roles', jsonb_build_array('admin', 'dispatcher'),
            'excludedUserId', NEW.closed_by,
            'title', 'Job Closed',
            'body', 'Job #' || NEW.job_id || ' completed - ' || COALESCE(NEW.customer_name, 'Customer'),
            'jobId', NEW.job_id
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to send push notification for job %: %', NEW.job_id, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Drop and recreate triggers to ensure they fire
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

-- Step 5: Verify setup
DO $$
DECLARE
  url_val TEXT;
  key_val TEXT;
  trigger_count INTEGER;
BEGIN
  SELECT value INTO url_val FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO key_val FROM app_config WHERE key = 'service_role_key';
  SELECT COUNT(*) INTO trigger_count FROM information_schema.triggers
    WHERE event_object_table = 'jobs' AND trigger_name IN ('on_job_added', 'on_job_closed');

  RAISE NOTICE '✓ Supabase URL: %', url_val;
  RAISE NOTICE '✓ Service role key configured: %', (key_val IS NOT NULL);
  RAISE NOTICE '✓ Triggers attached: %', trigger_count;

  IF url_val != 'https://api.onpointprodoors.com' THEN
    RAISE WARNING 'WARNING: URL is not production domain!';
  END IF;

  IF trigger_count != 2 THEN
    RAISE WARNING 'WARNING: Expected 2 triggers, found %', trigger_count;
  END IF;
END $$;
