-- Add allowed_lead_sources column for dispatcher permissions
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS allowed_lead_sources TEXT[];

COMMENT ON COLUMN profiles.allowed_lead_sources IS 'Array of lead source names that dispatcher is allowed to see and create jobs for';

-- Drop old dispatcher policies that allow access to all jobs
DROP POLICY IF EXISTS jobs_dispatcher_select ON jobs;
DROP POLICY IF EXISTS jobs_dispatcher_insert ON jobs;
DROP POLICY IF EXISTS jobs_dispatcher_update ON jobs;

-- Create helper function to check if dispatcher can access a job based on lead source
CREATE OR REPLACE FUNCTION dispatcher_can_access_job(job_source TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
  allowed_sources TEXT[];
  source_name TEXT;
BEGIN
  -- Get user role
  user_role := get_user_role();

  -- Non-dispatchers are handled by other policies
  IF user_role != 'dispatcher' THEN
    RETURN FALSE;
  END IF;

  -- Get dispatcher's allowed sources
  SELECT allowed_lead_sources INTO allowed_sources
  FROM profiles
  WHERE id = auth.uid();

  -- If no allowed sources set, allow all (backward compatibility)
  IF allowed_sources IS NULL OR array_length(allowed_sources, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Check if job source is 'my_lead' and dispatcher is allowed to see it
  IF job_source = 'my_lead' THEN
    RETURN 'my_lead' = ANY(allowed_sources);
  END IF;

  -- Check if job source ID matches one of the allowed lead source names
  -- We need to look up the lead source name from settings
  SELECT ls->>'name' INTO source_name
  FROM app_settings, jsonb_array_elements(lead_sources) ls
  WHERE ls->>'id' = job_source
  LIMIT 1;

  -- If we found the source name, check if it's in allowed list
  IF source_name IS NOT NULL THEN
    RETURN source_name = ANY(allowed_sources);
  END IF;

  -- Default deny
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- New dispatcher SELECT policy with lead source filtering
CREATE POLICY jobs_dispatcher_select ON jobs
  FOR SELECT
  TO public
  USING (
    get_user_role() = 'dispatcher' AND dispatcher_can_access_job(source)
  );

-- New dispatcher INSERT policy with lead source filtering
CREATE POLICY jobs_dispatcher_insert ON jobs
  FOR INSERT
  TO public
  WITH CHECK (
    get_user_role() = 'dispatcher' AND dispatcher_can_access_job(source)
  );

-- New dispatcher UPDATE policy with lead source filtering
CREATE POLICY jobs_dispatcher_update ON jobs
  FOR UPDATE
  TO public
  USING (
    get_user_role() = 'dispatcher' AND dispatcher_can_access_job(source)
  )
  WITH CHECK (
    get_user_role() = 'dispatcher' AND dispatcher_can_access_job(source)
  );

COMMENT ON FUNCTION dispatcher_can_access_job IS 'Check if dispatcher can access job based on allowed_lead_sources in their profile';
