-- ============================================================
-- INVITE SYSTEM + PUSH SUBSCRIPTIONS
-- ============================================================

-- ── push_subscriptions table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_sub_own" ON push_subscriptions
  FOR ALL USING (auth.uid() = user_id);

-- ── is_first_setup_needed ────────────────────────────────────
-- Callable by anon + authenticated. Returns true only when
-- zero admin profiles exist (app has never been set up).
CREATE OR REPLACE FUNCTION is_first_setup_needed()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_first_setup_needed() TO anon, authenticated;

-- ── complete_first_admin_setup ───────────────────────────────
-- Promotes the calling user to admin ONLY when no admin exists.
-- This is the one-time bootstrap; afterward the function is a no-op.
CREATE OR REPLACE FUNCTION complete_first_admin_setup()
RETURNS BOOLEAN AS $$
DECLARE
  calling_user_id UUID;
BEGIN
  calling_user_id := auth.uid();

  IF calling_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Abort if an admin already exists (prevent privilege escalation)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles SET role = 'admin' WHERE id = calling_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_first_admin_setup() TO authenticated;

-- ── get_users_for_admin ──────────────────────────────────────
-- Returns profile data joined with auth email + last_sign_in_at.
-- Only executable by admin role (checked inside function).
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
