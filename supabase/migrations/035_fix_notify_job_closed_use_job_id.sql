-- FIX: notify_job_closed() trigger uses NEW.id which doesn't exist
-- Same issue as notify_job_added() - jobs table uses job_id, not id

CREATE OR REPLACE FUNCTION notify_job_closed()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_key TEXT;
BEGIN
  -- Only notify if status changed to closed
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    BEGIN
      supabase_url := current_setting('app.supabase_url', true);
      service_key := current_setting('app.service_role_key', true);

      -- Only send notification if settings are configured
      IF supabase_url IS NOT NULL AND supabase_url != '' AND service_key IS NOT NULL AND service_key != '' THEN
        PERFORM net.http_post(
          url := supabase_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_key
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
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Log error but don't fail the transaction
      RAISE WARNING 'Failed to send push notification for job %: %', NEW.job_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
