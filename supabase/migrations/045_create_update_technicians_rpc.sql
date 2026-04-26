-- ════════════════════════════════════════════════════════════════
-- CREATE MISSING RPC FUNCTION FOR UPDATING TECHNICIANS
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_app_settings_technicians(techs_json JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow admins to call this
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Update technicians column in app_settings
  UPDATE app_settings
  SET technicians = techs_json
  WHERE id = 1;
END;
$$;

COMMENT ON FUNCTION update_app_settings_technicians IS
'Admin-only RPC to update technicians array in app_settings. Bypasses Supabase client schema cache.';
