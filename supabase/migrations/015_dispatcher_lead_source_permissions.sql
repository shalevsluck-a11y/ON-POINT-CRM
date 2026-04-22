-- Add lead source permissions for dispatchers
-- Created: 2026-04-22
--
-- Dispatchers can be restricted to see only jobs from specific lead sources
-- If no lead sources assigned = can't see any jobs
-- If lead sources assigned = can see only jobs from those sources

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS allowed_lead_sources TEXT[] DEFAULT NULL;

COMMENT ON COLUMN profiles.allowed_lead_sources IS
  'Array of lead source names this dispatcher can see. NULL = admin (see all), empty array = see nothing, populated array = see only those sources';

-- Update RLS policy for dispatcher SELECT to filter by lead sources
DROP POLICY IF EXISTS jobs_dispatcher_select ON jobs;

CREATE POLICY jobs_dispatcher_select ON jobs
  FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'dispatcher' AND (
      -- If allowed_lead_sources is NULL (shouldn't happen for dispatcher), see nothing
      -- If allowed_lead_sources is empty array, see nothing
      -- If allowed_lead_sources has values, see jobs from those sources
      (SELECT allowed_lead_sources FROM profiles WHERE id = auth.uid()) IS NOT NULL
      AND array_length((SELECT allowed_lead_sources FROM profiles WHERE id = auth.uid()), 1) > 0
      AND source = ANY((SELECT allowed_lead_sources FROM profiles WHERE id = auth.uid()))
    )
  );

COMMENT ON POLICY jobs_dispatcher_select ON jobs IS
  'Dispatcher can only see jobs from their assigned lead sources';
