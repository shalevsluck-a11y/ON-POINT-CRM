-- Create configuration table for push notification settings
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Supabase URL and Service Role Key
INSERT INTO app_config (key, value) VALUES
  ('supabase_url', 'https://nmmpemjcnncjfpooytpv.supabase.co'),
  ('service_role_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjY4OTc3MiwiZXhwIjoyMDkyMjY1NzcyfQ.2YtvB-qcKyEPxmYRKzWcpK9f-vUZ5TFgRKGe0oJ_PZA')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Update trigger to read from config table
CREATE OR REPLACE FUNCTION notify_job_assigned()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Only notify if tech was just assigned or changed
  IF NEW.assigned_tech_id IS NOT NULL AND
     (OLD.assigned_tech_id IS NULL OR OLD.assigned_tech_id != NEW.assigned_tech_id) THEN

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
            'targetUserId', NEW.assigned_tech_id,
            'title', 'New Job Assigned',
            'body', 'Job #' || NEW.job_id || ' - ' || COALESCE(NEW.customer_name, 'Customer'),
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

-- RLS policies for app_config (admin only)
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read config" ON app_config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin can update config" ON app_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
