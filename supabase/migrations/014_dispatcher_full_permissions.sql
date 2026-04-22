-- Grant dispatcher full job permissions (DELETE)
-- Created: 2026-04-22
--
-- Dispatcher should have full permissions on jobs (add, edit, close, delete)
-- Settings page is hidden via UI, not RLS

-- Allow dispatcher to DELETE jobs
DROP POLICY IF EXISTS jobs_dispatcher_delete ON jobs;

CREATE POLICY jobs_dispatcher_delete ON jobs
  FOR DELETE
  TO authenticated
  USING (get_user_role() = 'dispatcher');

COMMENT ON POLICY jobs_dispatcher_delete ON jobs IS
  'Allow dispatcher to delete jobs';
