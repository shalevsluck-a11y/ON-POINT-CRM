-- Update get_users_for_admin to include magic_token so admin can see/share magic links

DROP FUNCTION IF EXISTS get_users_for_admin();

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
  created_at      TIMESTAMPTZ,
  magic_token     TEXT
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
      p.created_at,
      p.magic_token
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_users_for_admin() IS 'Returns all users with magic tokens for admin management';
