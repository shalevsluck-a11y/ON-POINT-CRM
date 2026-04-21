-- Push Notifications Migration
-- Creates push_subscriptions table and job assignment notification trigger

-- Create push_subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

-- Enable RLS on push_subscriptions
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own push subscriptions
CREATE POLICY "Users can insert own push subscriptions"
  ON push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own push subscriptions"
  ON push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own push subscriptions"
  ON push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
  ON push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- Admins/dispatchers can view all subscriptions (for sending notifications)
CREATE POLICY "Admins can view all push subscriptions"
  ON push_subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'dispatcher')
    )
  );

-- Create function to notify assigned tech via Edge Function
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
        'url', '/?job=' || NEW.id,
        'tag', 'job-' || NEW.id,
        'jobId', NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for job assignments
DROP TRIGGER IF EXISTS on_job_assigned ON jobs;
CREATE TRIGGER on_job_assigned
  AFTER INSERT OR UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_job_assigned();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON push_subscriptions TO postgres, authenticated, service_role;
GRANT SELECT ON push_subscriptions TO anon;
