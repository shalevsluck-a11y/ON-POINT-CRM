-- Migration 032: FINAL FIX - Replace ALL trigger functions to use job_id instead of id
-- This fixes the "record 'new' has no field 'id'" error completely

-- ============================================================================
-- NOTIFICATION TRIGGER FUNCTIONS - Use app_config table instead of current_setting
-- ============================================================================

-- Function: notify_job_added - Sends push notifications when job is created
CREATE OR REPLACE FUNCTION notify_job_added()
RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  -- Get config from app_config table
  SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';

  -- Skip if config not available
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Send push notification - USING job_id NOT id
  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
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
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the insert if notification fails
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: notify_job_closed - Sends push notifications when job is closed
CREATE OR REPLACE FUNCTION notify_job_closed()
RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  -- Only notify if status changed to closed
  IF NEW.status != 'closed' OR (OLD.status = 'closed') THEN
    RETURN NEW;
  END IF;

  -- Get config from app_config table
  SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';

  -- Skip if config not available
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Send push notification - USING job_id NOT id
  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
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

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the update if notification fails
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: notify_job_assigned - Sends push notifications when job is assigned
CREATE OR REPLACE FUNCTION notify_job_assigned()
RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_assigned_to_id UUID;
BEGIN
  -- Skip if not assigned or unchanged
  IF NEW.assigned_to IS NULL OR NEW.assigned_to = OLD.assigned_to THEN
    RETURN NEW;
  END IF;

  -- Get config from app_config table
  SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';

  -- Skip if config not available
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get assigned user ID
  SELECT id INTO v_assigned_to_id
  FROM profiles
  WHERE name = NEW.assigned_to
  LIMIT 1;

  IF v_assigned_to_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Send push notification - USING job_id NOT id
  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'userId', v_assigned_to_id,
      'title', 'Job Assigned',
      'body', 'You have been assigned to Job #' || NEW.job_id || ' - ' || COALESCE(NEW.customer_name, 'Customer'),
      'url', '/?job=' || NEW.job_id,
      'tag', 'job-assigned-' || NEW.job_id,
      'jobId', NEW.job_id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the update if notification fails
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RECREATE ALL TRIGGERS
-- ============================================================================

-- Trigger: on_job_added
DROP TRIGGER IF EXISTS on_job_added ON jobs;
CREATE TRIGGER on_job_added
  AFTER INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_added();

-- Trigger: on_job_status_closed
DROP TRIGGER IF EXISTS on_job_status_closed ON jobs;
CREATE TRIGGER on_job_status_closed
  AFTER UPDATE ON jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'closed')
  EXECUTE FUNCTION notify_job_closed();

-- Trigger: on_job_assigned
DROP TRIGGER IF EXISTS on_job_assigned ON jobs;
CREATE TRIGGER on_job_assigned
  AFTER UPDATE ON jobs
  FOR EACH ROW
  WHEN (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL)
  EXECUTE FUNCTION notify_job_assigned();

-- Add comments
COMMENT ON FUNCTION notify_job_added() IS 'Sends push notification when job is added - uses job_id not id';
COMMENT ON FUNCTION notify_job_closed() IS 'Sends push notification when job is closed - uses job_id not id';
COMMENT ON FUNCTION notify_job_assigned() IS 'Sends push notification when job is assigned - uses job_id not id';
