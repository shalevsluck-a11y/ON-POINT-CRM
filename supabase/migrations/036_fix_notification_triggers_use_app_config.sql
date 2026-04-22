-- FIX: Update notification triggers to read from app_config table instead of current_setting()
-- This is consistent with notify_job_assigned which already uses app_config

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
    -- Config not found - skip notification silently
    RETURN NEW;
  END;

  -- Only proceed if settings are configured
  IF supabase_url IS NOT NULL AND service_role_key IS NOT NULL THEN
    -- Call Edge Function via pg_net extension
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
          'jobId', NEW.job_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Log error but don't fail the transaction
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
  -- Only notify if status changed to closed
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    BEGIN
      -- Get configuration from table
      SELECT value INTO supabase_url FROM app_config WHERE key = 'supabase_url';
      SELECT value INTO service_role_key FROM app_config WHERE key = 'service_role_key';
    EXCEPTION WHEN OTHERS THEN
      -- Config not found - skip notification silently
      RETURN NEW;
    END;

    -- Only proceed if settings are configured
    IF supabase_url IS NOT NULL AND service_role_key IS NOT NULL THEN
      -- Call Edge Function via pg_net extension
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
            'jobId', NEW.job_id
          )
        );
      EXCEPTION WHEN OTHERS THEN
        -- Log error but don't fail the transaction
        RAISE WARNING 'Failed to send push notification for job %: %', NEW.job_id, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
