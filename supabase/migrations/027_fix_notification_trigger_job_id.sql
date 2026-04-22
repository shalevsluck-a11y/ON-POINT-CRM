-- FIX: Change NEW.id to NEW.job_id in notification triggers
-- The jobs table primary key is job_id, not id
-- This was causing "record new has no field id" errors and preventing job saves

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
      'url', '/?job=' || NEW.job_id,  -- FIXED: was NEW.id
      'tag', 'job-added-' || NEW.job_id,  -- FIXED: was NEW.id
      'jobId', NEW.job_id  -- FIXED: was NEW.id
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION notify_job_closed()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify if status changed to closed
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    PERFORM net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := jsonb_build_object(
        'broadcast', true,
        'roles', jsonb_build_array('admin', 'dispatcher'),
        'title', 'Job Closed',
        'body', 'Job #' || NEW.job_id || ' completed - ' || COALESCE(NEW.customer_name, 'Customer'),
        'url', '/?job=' || NEW.job_id,  -- FIXED: was NEW.id
        'tag', 'job-closed-' || NEW.job_id,  -- FIXED: was NEW.id
        'jobId', NEW.job_id  -- FIXED: was NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION notify_job_added() IS 'FIXED: Changed NEW.id to NEW.job_id - jobs table uses job_id as primary key';
COMMENT ON FUNCTION notify_job_closed() IS 'FIXED: Changed NEW.id to NEW.job_id - jobs table uses job_id as primary key';
