-- Magic link authentication - unique links per user
-- Created: 2026-04-22

CREATE TABLE IF NOT EXISTS magic_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '365 days')
);

CREATE INDEX magic_tokens_user_id_idx ON magic_tokens(user_id);
CREATE INDEX magic_tokens_token_idx ON magic_tokens(token);

-- RLS policies
ALTER TABLE magic_tokens ENABLE ROW LEVEL SECURITY;

-- Admin can manage all tokens
CREATE POLICY magic_tokens_admin_all ON magic_tokens
  FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin');

-- Users can read their own tokens
CREATE POLICY magic_tokens_own_select ON magic_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE magic_tokens IS 'Magic link tokens for password-less authentication';
