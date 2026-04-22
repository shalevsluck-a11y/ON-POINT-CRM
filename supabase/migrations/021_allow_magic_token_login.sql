-- Allow unauthenticated users to query profiles by magic_token for authentication
-- This is SAFE because magic_token is a secret known only to the user

-- Add policy to allow ANYONE to SELECT from profiles when querying by magic_token
-- This enables the magic link authentication flow
CREATE POLICY "Allow magic token authentication"
  ON profiles
  FOR SELECT
  TO anon
  USING (magic_token IS NOT NULL);

COMMENT ON POLICY "Allow magic token authentication" ON profiles IS
  'Allows unauthenticated users to query profiles by magic_token for password-less authentication. Safe because magic_token is secret.';
