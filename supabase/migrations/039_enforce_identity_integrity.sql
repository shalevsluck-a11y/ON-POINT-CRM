-- IDENTITY INTEGRITY ENFORCEMENT
-- Ensures auth.users.id is the single source of truth for all identity references

-- Step 1: Add foreign key constraints to enforce referential integrity
-- This prevents orphaned profiles or push_subscriptions

-- Profiles must match auth.users
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- Push subscriptions must reference valid profiles
ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES profiles(id)
  ON DELETE CASCADE;

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_jobs_created_by
  ON jobs(created_by);

-- Step 2: Add trigger to auto-create profile on auth user creation
-- This ensures every authenticated user has a profile
CREATE OR REPLACE FUNCTION create_profile_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create profile if it doesn't exist
  INSERT INTO profiles (id, name, role, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    'tech', -- Default role, can be changed by admin
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_profile_for_new_user();

-- Step 3: Add automatic cleanup of stale push subscriptions
-- Keep only the most recent subscription per user (already exists via trigger)

-- Step 4: Add comments for documentation
COMMENT ON CONSTRAINT profiles_id_fkey ON profiles IS
  'Enforces: profile.id MUST equal auth.users.id - no orphaned profiles allowed';

COMMENT ON CONSTRAINT push_subscriptions_user_id_fkey ON push_subscriptions IS
  'Enforces: subscription user_id MUST reference valid profile - no orphaned subscriptions allowed';

COMMENT ON FUNCTION create_profile_for_new_user() IS
  'Auto-creates profile for every new auth user to maintain 1:1 relationship';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Identity integrity constraints enforced';
  RAISE NOTICE '✅ Auto-profile creation enabled';
  RAISE NOTICE '✅ Foreign keys: profiles.id → auth.users.id';
  RAISE NOTICE '✅ Foreign keys: push_subscriptions.user_id → profiles.id';
END $$;
