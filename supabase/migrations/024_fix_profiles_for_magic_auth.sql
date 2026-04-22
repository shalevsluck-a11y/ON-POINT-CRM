-- Fix profiles table for magic link authentication
-- Remove auth.users foreign key and add UUID default

-- Drop foreign key constraint (not needed for magic link auth)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Add UUID default for ID column
ALTER TABLE profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Update function to not require ID parameter
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

  -- Insert and return the new profile with auto-generated ID and magic token
  RETURN QUERY
  INSERT INTO profiles (name, role, color, is_owner)
  VALUES (p_name, 'dispatcher', v_color, false)
  RETURNING profiles.id, profiles.magic_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_dispatcher_profile IS
  'Creates a new dispatcher profile with auto-generated UUID. Uses SECURITY DEFINER to bypass RLS.';
