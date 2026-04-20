-- ============================================================
-- MIGRATION 005 — Realtime DELETE support + function safety
-- ============================================================
-- Run this in Supabase SQL Editor AFTER migrations 001-004.
-- It is safe to re-run (all statements are idempotent).
-- ============================================================

-- ── 1. Enable REPLICA IDENTITY FULL on jobs ──────────────────
-- Required so DELETE events include the full old row (job_id, etc.)
-- so the client can remove the deleted job from local cache.
ALTER TABLE jobs REPLICA IDENTITY FULL;

-- Also enable for notifications so realtime DELETE events work there too
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- ── 2. Ensure push_subscriptions table exists ─────────────────
-- (from migration 004 — safe to re-run with IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'push_subscriptions' AND policyname = 'push_sub_own'
  ) THEN
    ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "push_sub_own" ON push_subscriptions
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── 3. Recreate all setup functions (idempotent) ──────────────

-- is_first_setup_needed: callable by anon and authenticated
CREATE OR REPLACE FUNCTION is_first_setup_needed()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_first_setup_needed() TO anon, authenticated;

-- complete_first_admin_setup: one-time bootstrap — promotes caller to admin
CREATE OR REPLACE FUNCTION complete_first_admin_setup()
RETURNS BOOLEAN AS $$
DECLARE
  calling_user_id UUID;
BEGIN
  calling_user_id := auth.uid();

  IF calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Abort if an admin already exists (prevents privilege escalation)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles SET role = 'admin' WHERE id = calling_user_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_first_admin_setup() TO authenticated;

-- get_users_for_admin: returns profile + auth email for admin user management
CREATE OR REPLACE FUNCTION get_users_for_admin()
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  email           TEXT,
  role            TEXT,
  color           TEXT,
  phone           TEXT,
  is_owner        BOOLEAN,
  last_sign_in_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ
) AS $$
BEGIN
  IF (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) <> 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.name,
      u.email::TEXT,
      p.role,
      p.color,
      p.phone,
      p.is_owner,
      u.last_sign_in_at,
      p.created_at
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    ORDER BY p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_users_for_admin() TO authenticated;

-- ── 4. Ensure realtime is enabled for all required tables ─────
-- (safe to re-run — ALTER PUBLICATION ignores already-added tables)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── 5. Ensure the auth trigger sets role = 'tech' (not from metadata) ──
-- Recreate the handle_new_user trigger to be safe
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    'tech'  -- always 'tech' — role is promoted explicitly, never from user metadata
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger (drop and recreate to ensure it's current)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── 6. Verify RLS is enabled on all tables ───────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_zelle      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings   ENABLE ROW LEVEL SECURITY;
