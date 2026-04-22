-- FIX: notify_job_added() should not fail if push notifications aren't configured
-- Wrap the http_post call in exception handling so job creation doesn't fail
-- if the push service URL isn't set or the call fails

CREATE OR REPLACE FUNCTION notify_job_added()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_key TEXT;
BEGIN
  -- Try to get settings, but don't fail if they're not configured
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
          'title', 'New Job Added',
          'body', 'Job #' || NEW.job_id || ' - ' || COALESCE(NEW.customer_name, 'Customer'),
          'url', '/?job=' || NEW.job_id,
          'tag', 'job-added-' || NEW.job_id,
          'jobId', NEW.job_id
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the transaction
    RAISE WARNING 'Failed to send push notification for job %: %', NEW.job_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
