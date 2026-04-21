-- ============================================================
-- Optimize users list performance
-- ============================================================

-- Add index on profiles.role for faster admin checks
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Add index on profiles.name for faster ORDER BY in get_users_for_admin
CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
