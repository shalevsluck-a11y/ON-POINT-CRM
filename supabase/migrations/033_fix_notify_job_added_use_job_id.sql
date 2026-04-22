-- FIX: notify_job_added() trigger uses NEW.id which doesn't exist
-- The jobs table has job_id as the primary key, not id
-- This causes "record 'new' has no field 'id'" error when saving jobs via REST API

CREATE OR REPLACE FUNCTION notify_job_added()
RETURNS TRIGGER AS $$
BEGIN
  -- Send notification to ALL admin and dispatcher users
  PERFORM net.http_post(
    url := current_setting('app.supabase_url', true) || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
