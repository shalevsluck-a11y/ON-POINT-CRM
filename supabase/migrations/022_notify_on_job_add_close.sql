-- Push notifications for job add and close events
-- Notifies ALL admin/dispatcher users when ANY job is added or closed

-- Function to notify all admin/dispatcher users when job is added
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
      'url', '/?job=' || NEW.id,
      'tag', 'job-added-' || NEW.id,
      'jobId', NEW.id
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to notify all admin/dispatcher users when job is closed
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
        'url', '/?job=' || NEW.id,
        'tag', 'job-closed-' || NEW.id,
        'jobId', NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for job additions
DROP TRIGGER IF EXISTS on_job_added ON jobs;
CREATE TRIGGER on_job_added
  AFTER INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_added();

-- Create trigger for job status changes (closed)
DROP TRIGGER IF EXISTS on_job_status_closed ON jobs;
CREATE TRIGGER on_job_status_closed
  AFTER UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_closed();

COMMENT ON FUNCTION notify_job_added() IS 'Sends push notification to all admin/dispatcher users when a job is added';
COMMENT ON FUNCTION notify_job_closed() IS 'Sends push notification to all admin/dispatcher users when a job is closed';
