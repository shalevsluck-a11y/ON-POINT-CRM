-- Add closed_by field to track who closed the job
-- Update notification triggers to exclude the user who performed the action

-- Step 1: Add closed_by column to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES profiles(id);

-- Step 2: Create trigger to auto-set closed_by when status changes to closed
CREATE OR REPLACE FUNCTION set_closed_by()
RETURNS TRIGGER AS $$
BEGIN
  -- If status changed to closed and closed_by is not already set
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') AND NEW.closed_by IS NULL THEN
    -- Try to get current user from JWT context
    BEGIN
      NEW.closed_by := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      -- If no auth context, leave as NULL
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_job_closed_set_user ON jobs;
CREATE TRIGGER on_job_closed_set_user
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_closed_by();

-- Step 3: Update notify_job_added to exclude creator
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
          'excludedUserId', NEW.created_by,  -- EXCLUDE THE CREATOR
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

-- Step 4: Update notify_job_closed to exclude closer
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
            'excludedUserId', NEW.closed_by,  -- EXCLUDE WHO CLOSED IT
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

COMMENT ON FUNCTION notify_job_added() IS 'Sends push to all admin/dispatcher EXCEPT the creator';
COMMENT ON FUNCTION notify_job_closed() IS 'Sends push to all admin/dispatcher EXCEPT who closed it';
COMMENT ON COLUMN jobs.closed_by IS 'User who changed status to closed';
