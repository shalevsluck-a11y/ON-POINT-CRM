-- Migration 031: Recreate ALL triggers with ZERO .id references
-- This is the NUCLEAR option - completely drop and recreate all notification triggers
-- to ensure absolutely no reference to NEW.id remains anywhere

-- Recreate notify_job_assigned with ZERO .id references
CREATE OR REPLACE FUNCTION notify_job_assigned()
RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_assigned_to_id UUID;
  v_assigned_to_name TEXT;
BEGIN
  SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN RETURN NEW; END IF;
  IF NEW.assigned_to IS NULL THEN RETURN NEW; END IF;

  SELECT id, name INTO v_assigned_to_id, v_assigned_to_name
  FROM profiles WHERE name = NEW.assigned_to LIMIT 1;

  IF v_assigned_to_id IS NULL THEN RETURN NEW; END IF;

  PERFORM pg_notify('job_assigned', json_build_object(
    'user_id', v_assigned_to_id,
    'job_id', NEW.job_id,
    'customer_name', NEW.customer_name
  )::text);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_job_assigned
AFTER UPDATE ON jobs
FOR EACH ROW
WHEN (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL)
EXECUTE FUNCTION notify_job_assigned();

-- Recreate notify_job_closed with ZERO .id references
CREATE OR REPLACE FUNCTION notify_job_closed()
RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN RETURN NEW; END IF;

  PERFORM pg_notify('job_closed', json_build_object(
    'job_id', NEW.job_id,
    'customer_name', NEW.customer_name,
    'closed_at', NEW.closed_at
  )::text);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_job_status_closed
AFTER UPDATE ON jobs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'closed')
EXECUTE FUNCTION notify_job_status_closed();
