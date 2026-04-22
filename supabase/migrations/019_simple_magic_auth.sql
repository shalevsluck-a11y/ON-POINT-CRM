-- Simple magic link system - no passwords
-- Each user has a permanent token, visit link once and you're in forever

-- Add token column to profiles (this IS the authentication)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS magic_token TEXT UNIQUE;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS profiles_magic_token_idx ON profiles(magic_token);

-- Function to auto-generate token when user is created
CREATE OR REPLACE FUNCTION generate_magic_token()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate unique 32-char token if not set
  IF NEW.magic_token IS NULL THEN
    NEW.magic_token := substring(md5(random()::text || NEW.id::text) from 1 for 32);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate tokens
DROP TRIGGER IF EXISTS profiles_magic_token_trigger ON profiles;
CREATE TRIGGER profiles_magic_token_trigger
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_magic_token();

-- Update existing users with tokens
UPDATE profiles
SET magic_token = substring(md5(random()::text || id::text) from 1 for 32)
WHERE magic_token IS NULL;

COMMENT ON COLUMN profiles.magic_token IS 'Permanent authentication token - user visits link once and stays logged in forever';
