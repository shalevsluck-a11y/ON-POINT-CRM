-- ════════════════════════════════════════════════════════════════
-- FORCE APPLY TECHNICIANS COLUMN + RPC BYPASS FOR SCHEMA CACHE
-- ════════════════════════════════════════════════════════════════

-- Ensure technicians column exists (idempotent)
ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS technicians JSONB DEFAULT '[]';

-- Update existing row
UPDATE app_settings
SET technicians = '[]'
WHERE technicians IS NULL;

-- Create RPC function to update settings (bypasses Supabase client schema cache)
CREATE OR REPLACE FUNCTION update_app_settings(updates JSONB)
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

  -- Update the settings row
  UPDATE app_settings
  SET
    owner_name = COALESCE((updates->>'ownerName')::text, owner_name),
    owner_phone = COALESCE((updates->>'ownerPhone')::text, owner_phone),
    owner_zelle = COALESCE((updates->>'ownerZelle')::text, owner_zelle),
    tax_rate_ny = COALESCE((updates->>'taxRateNY')::numeric, tax_rate_ny),
    tax_rate_nj = COALESCE((updates->>'taxRateNJ')::numeric, tax_rate_nj),
    default_state = COALESCE((updates->>'defaultState')::text, default_state),
    apps_script_url = COALESCE((updates->>'appsScriptUrl')::text, apps_script_url),
    lead_sources = COALESCE((updates->'leadSources')::jsonb, lead_sources),
    technicians = COALESCE((updates->'technicians')::jsonb, technicians)
  WHERE id = 1;
END;
$$;

COMMENT ON FUNCTION update_app_settings IS
'Admin-only RPC to update app_settings. Bypasses Supabase client schema cache issues.';
