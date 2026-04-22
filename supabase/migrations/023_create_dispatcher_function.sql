-- Function to create dispatcher profile (bypasses RLS with SECURITY DEFINER)
-- Needed because magic link auth doesn't set auth.uid()

CREATE OR REPLACE FUNCTION create_dispatcher_profile(
  p_name TEXT,
  p_color TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  magic_token TEXT
) AS $$
DECLARE
  v_color TEXT;
BEGIN
  -- Generate random color if not provided
  IF p_color IS NULL THEN
    v_color := '#' || lpad(to_hex(floor(random() * 16777215)::int), 6, '0');
  ELSE
    v_color := p_color;
  END IF;

  -- Insert and return the new profile with magic token
  RETURN QUERY
  INSERT INTO profiles (name, role, color, is_owner)
  VALUES (p_name, 'dispatcher', v_color, false)
  RETURNING profiles.id, profiles.magic_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_dispatcher_profile TO anon, authenticated;

COMMENT ON FUNCTION create_dispatcher_profile IS
  'Creates a new dispatcher profile. Uses SECURITY DEFINER to bypass RLS for magic link auth.';
