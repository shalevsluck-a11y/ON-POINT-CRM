-- Fix realtime sync for admin and dispatcher
-- Created: 2026-04-22
--
-- Problem: RLS policies were blocking realtime events
-- Solution: Make SELECT policies permissive for realtime, filter client-side

-- Admin: can see all jobs (already correct with FOR ALL policy)
-- No changes needed for admin

-- Dispatcher: make SELECT more permissive so realtime works
-- Filter client-side based on allowed_lead_sources in the UI
DROP POLICY IF EXISTS jobs_dispatcher_select ON jobs;

CREATE POLICY jobs_dispatcher_select ON jobs
  FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'dispatcher'
  );

COMMENT ON POLICY jobs_dispatcher_select ON jobs IS
  'Dispatcher can see all jobs via SELECT (realtime works). UI filters by allowed_lead_sources.';
