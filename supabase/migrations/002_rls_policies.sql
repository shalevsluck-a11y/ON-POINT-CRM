-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_zelle    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- ── PROFILES ─────────────────────────────────────────────────
-- Users can always read and update their own profile
CREATE POLICY "profiles_own_read"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_own_update" ON profiles FOR UPDATE USING (auth.uid() = id);
-- Admin can read and manage all profiles
CREATE POLICY "profiles_admin_all"  ON profiles FOR ALL USING (get_user_role() = 'admin');

-- ── JOBS ─────────────────────────────────────────────────────
-- IMPORTANT: assigned_tech_id MUST be the Supabase auth.uid() (profiles.id UUID).
-- The app's _syncSettingsDown() loads technicians from profiles.id, so new jobs
-- written after DB init will have the correct UUID. Jobs created entirely offline
-- with Storage.generateId() IDs will have a short string that cannot match auth.uid()
-- and will be invisible to the tech via RLS — this is the safe-fail direction.
-- See Finding #10 in the security audit for migration guidance.
--
-- NOTE: Postgres RLS is row-level only. Financial columns (owner_payout,
-- contractor_fee, job_total) are still returned to tech users who pass row
-- access. Column masking requires Postgres column-level privileges or a DB view.
-- The job_zelle table provides column separation for Zelle memos only.
-- Consider a Supabase DB view "jobs_tech_view" that excludes financial columns
-- for a complete fix (see Finding #4 in the audit).
--
-- Admin: full access to all jobs
CREATE POLICY "jobs_admin_all" ON jobs FOR ALL
  USING (get_user_role() = 'admin');

-- Dispatcher: can read all jobs, create and update (not delete)
CREATE POLICY "jobs_dispatcher_select" ON jobs FOR SELECT
  USING (get_user_role() = 'dispatcher');
CREATE POLICY "jobs_dispatcher_insert" ON jobs FOR INSERT
  WITH CHECK (get_user_role() = 'dispatcher');
CREATE POLICY "jobs_dispatcher_update" ON jobs FOR UPDATE
  USING (get_user_role() = 'dispatcher');

-- Tech: can only see jobs assigned to them
CREATE POLICY "jobs_tech_own_select" ON jobs FOR SELECT
  USING (
    get_user_role() = 'tech'
    AND assigned_tech_id = auth.uid()
  );
-- Tech: can update status, notes, photos on their own jobs only
-- WITH CHECK ensures they cannot reassign the job to someone else or modify financials at the row level.
-- Column-level financial protection is handled separately (see Finding #4 in audit).
CREATE POLICY "jobs_tech_own_update" ON jobs FOR UPDATE
  USING (
    get_user_role() = 'tech'
    AND assigned_tech_id = auth.uid()
  )
  WITH CHECK (
    get_user_role() = 'tech'
    AND assigned_tech_id = auth.uid()
  );

-- ── JOB_ZELLE (admin-only) ───────────────────────────────────
CREATE POLICY "job_zelle_admin_only" ON job_zelle FOR ALL
  USING (get_user_role() = 'admin');

-- ── NOTIFICATIONS ────────────────────────────────────────────
-- Users see notifications addressed to them or broadcast (user_id IS NULL)
CREATE POLICY "notifications_own_read" ON notifications FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "notifications_own_update" ON notifications FOR UPDATE
  USING (user_id = auth.uid() OR user_id IS NULL);
-- Admin and dispatcher can insert notifications for anyone
CREATE POLICY "notifications_insert" ON notifications FOR INSERT
  WITH CHECK (get_user_role() IN ('admin','dispatcher'));

-- ── APP SETTINGS ─────────────────────────────────────────────
-- All authenticated users can read settings
CREATE POLICY "settings_all_read" ON app_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- Only admin can update settings
CREATE POLICY "settings_admin_update" ON app_settings FOR UPDATE
  USING (get_user_role() = 'admin');
-- Only admin can insert the initial settings row
CREATE POLICY "settings_admin_insert" ON app_settings FOR INSERT
  WITH CHECK (get_user_role() = 'admin');
