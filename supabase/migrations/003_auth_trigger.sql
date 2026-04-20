-- ============================================================
-- AUTH TRIGGER — Create profile on signup
-- ============================================================

-- When a new user signs up via Supabase Auth, auto-create their profile.
-- Role defaults to 'tech'. Admin promotes users via the app.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'tech')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── JOBS: auto-set created_by ─────────────────────────────────
CREATE OR REPLACE FUNCTION jobs_set_created_by()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_jobs_created_by
  BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_set_created_by();

-- ── FUNCTION: notify_all_users ────────────────────────────────
-- Called from the app to broadcast a notification to all users
CREATE OR REPLACE FUNCTION notify_all_users(
  p_title   TEXT,
  p_body    TEXT,
  p_job_id  TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  -- Broadcast notification (user_id NULL = everyone sees it)
  INSERT INTO notifications (user_id, title, body, job_id)
  VALUES (NULL, p_title, p_body, p_job_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── FUNCTION: flag_overdue_jobs ──────────────────────────────
-- Called periodically or on-demand to flag jobs overdue by 24h
CREATE OR REPLACE FUNCTION flag_overdue_jobs()
RETURNS INTEGER AS $$
DECLARE
  flagged_count INTEGER;
BEGIN
  UPDATE jobs
  SET
    status = 'follow_up',
    overdue_flagged_at = now()
  WHERE
    status NOT IN ('closed', 'paid', 'follow_up')
    AND scheduled_date IS NOT NULL
    AND (scheduled_date + COALESCE(scheduled_time, '23:59:59'::TIME))
        < (now() - INTERVAL '24 hours')
    AND overdue_flagged_at IS NULL;

  GET DIAGNOSTICS flagged_count = ROW_COUNT;
  RETURN flagged_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
