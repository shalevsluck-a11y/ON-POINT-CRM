-- Fix dispatcher permissions to make lead source filtering optional
-- Created: 2026-04-22
--
-- NULL allowed_lead_sources = see all jobs (no restrictions)
-- Empty array [] = see nothing (explicit restriction)
-- Array with values = see only those sources

DROP POLICY IF EXISTS jobs_dispatcher_select ON jobs;

CREATE POLICY jobs_dispatcher_select ON jobs
  FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'dispatcher' AND (
      -- If allowed_lead_sources is NULL, see all jobs (unrestricted)
      (SELECT allowed_lead_sources FROM profiles WHERE id = auth.uid()) IS NULL
      OR
      -- If allowed_lead_sources has values, see only jobs from those sources
      (
        array_length((SELECT allowed_lead_sources FROM profiles WHERE id = auth.uid()), 1) > 0
        AND source = ANY((SELECT allowed_lead_sources FROM profiles WHERE id = auth.uid()))
      )
    )
  );

COMMENT ON POLICY jobs_dispatcher_select ON jobs IS
  'Dispatcher can see all jobs if allowed_lead_sources is NULL, or only assigned sources if configured';
