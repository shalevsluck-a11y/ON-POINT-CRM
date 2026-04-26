-- ═══════════════════════════════════════════════════════════════
-- RUN THIS IN SUPABASE SQL EDITOR
-- Fixes: 1) Technicians not saving  2) Schema cache issues
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Add technicians column (if it doesn't exist)
ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS technicians JSONB DEFAULT '[]';

-- Step 2: Initialize with empty array
UPDATE app_settings
SET technicians = '[]'
WHERE id = 1 AND technicians IS NULL;

-- Step 3: Create RPC function to bypass schema cache
CREATE OR REPLACE FUNCTION update_app_settings_technicians(techs_json JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow admins
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Update technicians
  UPDATE app_settings
  SET technicians = techs_json
  WHERE id = 1;
END;
$$;

-- Step 4: Grant execute permission
GRANT EXECUTE ON FUNCTION update_app_settings_technicians TO authenticated;

-- Verify it worked
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'app_settings'
AND column_name = 'technicians';
