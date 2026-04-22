-- Fix RLS policy for tech users to receive realtime events
-- Created: 2026-04-22 05:00 UTC
--
-- Issue: Tech users couldn't receive realtime events when jobs were assigned
-- because the restrictive SELECT policy blocked realtime updates.
--
-- Solution: Allow tech to SELECT all jobs (for realtime events to flow),
-- while client-side filtering shows only assigned jobs in UI.
-- UPDATE policy remains restrictive (tech can only update own jobs).

DROP POLICY IF EXISTS jobs_tech_own_select ON jobs;
DROP POLICY IF EXISTS jobs_tech_realtime_select ON jobs;

CREATE POLICY jobs_tech_select_all ON jobs
  FOR SELECT
  TO authenticated
  USING (get_user_role() = 'tech');

COMMENT ON POLICY jobs_tech_select_all ON jobs IS
  'Allow tech to SELECT all jobs for realtime events. Client-side filters to assigned jobs only.';
