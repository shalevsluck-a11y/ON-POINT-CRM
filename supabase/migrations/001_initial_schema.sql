-- ============================================================
-- ON POINT PRO DOORS CRM — Initial Database Schema
-- ============================================================

-- ── PROFILES (extends auth.users) ───────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL DEFAULT '',
  phone            TEXT DEFAULT '',
  role             TEXT NOT NULL DEFAULT 'tech' CHECK (role IN ('admin','dispatcher','tech')),
  color            TEXT DEFAULT '#3B82F6',
  zelle_handle     TEXT DEFAULT '',
  zip_codes        TEXT[] DEFAULT '{}',
  default_tech_percent NUMERIC(5,2) DEFAULT 60,
  is_owner         BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ── JOBS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  job_id               TEXT PRIMARY KEY,
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','scheduled','in_progress','closed','paid','follow_up')),
  customer_name        TEXT NOT NULL DEFAULT '',
  phone                TEXT DEFAULT '',
  address              TEXT DEFAULT '',
  city                 TEXT DEFAULT '',
  state                TEXT DEFAULT '',
  zip                  TEXT DEFAULT '',
  scheduled_date       DATE,
  scheduled_time       TIME,
  description          TEXT DEFAULT '',
  notes                TEXT DEFAULT '',
  source               TEXT DEFAULT 'my_lead',
  contractor_name      TEXT DEFAULT '',
  contractor_pct       NUMERIC(5,2) DEFAULT 0,
  assigned_tech_id     UUID REFERENCES profiles(id),
  assigned_tech_name   TEXT DEFAULT '',
  is_self_assigned     BOOLEAN DEFAULT false,
  tech_percent         NUMERIC(5,2) DEFAULT 0,
  estimated_total      NUMERIC(10,2) DEFAULT 0,
  job_total            NUMERIC(10,2) DEFAULT 0,
  parts_cost           NUMERIC(10,2) DEFAULT 0,
  tax_amount           NUMERIC(10,2) DEFAULT 0,
  tax_option           TEXT DEFAULT 'none',
  tech_payout          NUMERIC(10,2) DEFAULT 0,
  owner_payout         NUMERIC(10,2) DEFAULT 0,
  contractor_fee       NUMERIC(10,2) DEFAULT 0,
  payment_method       TEXT DEFAULT 'cash',
  paid_at              TIMESTAMPTZ,
  sync_status          TEXT DEFAULT 'pending',
  synced_at            TIMESTAMPTZ,
  photos               JSONB DEFAULT '[]',
  raw_lead             TEXT DEFAULT '',
  is_recurring_customer BOOLEAN DEFAULT false,
  overdue_flagged_at   TIMESTAMPTZ,
  follow_up_at         TIMESTAMPTZ,
  created_by           UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- ── JOB ZELLE (admin-only sensitive data) ───────────────────
CREATE TABLE IF NOT EXISTS job_zelle (
  job_id      TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
  zelle_memo  TEXT DEFAULT ''
);

-- ── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL = broadcast
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  job_id      TEXT REFERENCES jobs(job_id) ON DELETE SET NULL,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── APP SETTINGS (single row per app) ────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  owner_name      TEXT DEFAULT '',
  owner_phone     TEXT DEFAULT '',
  owner_zelle     TEXT DEFAULT '',
  tax_rate_ny     NUMERIC(6,3) DEFAULT 8.875,
  tax_rate_nj     NUMERIC(6,3) DEFAULT 6.625,
  default_state   TEXT DEFAULT 'NY',
  apps_script_url TEXT DEFAULT '',
  lead_sources    JSONB DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert default settings row
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_tech ON jobs(assigned_tech_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status        ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at    ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ── UPDATED_AT TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── HELPER: Get current user role ────────────────────────────
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── ENABLE REALTIME ──────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
