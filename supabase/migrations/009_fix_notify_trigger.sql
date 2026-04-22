-- Fix notify_job_assigned trigger to use job_id instead of id
CREATE OR REPLACE FUNCTION notify_job_assigned()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify if tech was just assigned or changed
  IF NEW.assigned_tech_id IS NOT NULL AND
     (OLD.assigned_tech_id IS NULL OR OLD.assigned_tech_id != NEW.assigned_tech_id) THEN

    -- Call Edge Function via pg_net extension (requires pg_net to be enabled)
    -- Note: This will be called asynchronously
    PERFORM net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := jsonb_build_object(
        'user_id', NEW.assigned_tech_id,
        'title', 'New Job Assigned',
        'body', 'Job #' || NEW.job_id || ' - ' || COALESCE(NEW.customer_name, 'Customer'),
        'url', '/?job=' || NEW.job_id,  -- FIXED: was NEW.id
        'tag', 'job-' || NEW.job_id,    -- FIXED: was NEW.id
        'jobId', NEW.job_id              -- FIXED: was NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
