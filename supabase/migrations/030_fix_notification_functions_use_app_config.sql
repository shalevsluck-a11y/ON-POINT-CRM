-- CRITICAL FIX: Update notification functions to use app_config table
-- This fixes the "record 'new' has no field 'id'" error that was actually
-- a "null url" error because current_setting() returned NULL

-- The functions now gracefully handle missing config and won't block job inserts

CREATE OR REPLACE FUNCTION notify_job_added()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
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
          'title', 'New Job Added',
          'body', 'Job #' || NEW.job_id || ' - ' || COALESCE(NEW.customer_name, 'Customer'),
          'url', '/?job=' || NEW.job_id,
          'tag', 'job-added-' || NEW.job_id,
          'jobId', NEW.job_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to send push notification: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
            'title', 'Job Closed',
            'body', 'Job #' || NEW.job_id || ' completed - ' || COALESCE(NEW.customer_name, 'Customer'),
            'url', '/?job=' || NEW.job_id,
            'tag', 'job-closed-' || NEW.job_id,
            'jobId', NEW.job_id
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to send push notification: %', SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION notify_job_added() IS 'Fixed to use app_config table - prevents null url errors that blocked job inserts';
COMMENT ON FUNCTION notify_job_closed() IS 'Fixed to use app_config table - prevents null url errors';
