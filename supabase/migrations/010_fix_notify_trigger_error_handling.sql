-- Improve notify_job_assigned trigger with better error handling
CREATE OR REPLACE FUNCTION notify_job_assigned()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Only notify if tech was just assigned or changed
  IF NEW.assigned_tech_id IS NOT NULL AND
     (OLD.assigned_tech_id IS NULL OR OLD.assigned_tech_id != NEW.assigned_tech_id) THEN

    -- Get configuration settings
    BEGIN
      supabase_url := current_setting('app.supabase_url', true);
      service_role_key := current_setting('app.service_role_key', true);
    EXCEPTION WHEN OTHERS THEN
      -- Settings not configured yet - skip notification silently
      RETURN NEW;
    END;

    -- Only proceed if settings are configured
    IF supabase_url IS NOT NULL AND service_role_key IS NOT NULL THEN
      -- Call Edge Function via pg_net extension (requires pg_net to be enabled)
      -- Note: This will be called asynchronously
      BEGIN
        PERFORM net.http_post(
          url := supabase_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_role_key
          ),
          body := jsonb_build_object(
            'user_id', NEW.assigned_tech_id,
            'title', 'New Job Assigned',
            'body', 'Job #' || NEW.job_id || ' - ' || COALESCE(NEW.customer_name, 'Customer'),
            'url', '/?job=' || NEW.job_id,
            'tag', 'job-' || NEW.job_id,
            'jobId', NEW.job_id
          )
        );
      EXCEPTION WHEN OTHERS THEN
        -- Log error but don't fail the transaction
        RAISE WARNING 'Failed to send push notification: %', SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_job_assigned ON jobs;
CREATE TRIGGER on_job_assigned
  AFTER INSERT OR UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_assigned();
