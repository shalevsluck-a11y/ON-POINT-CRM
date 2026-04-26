-- ════════════════════════════════════════════════════════════════
-- ADD TECHNICIANS COLUMN TO APP_SETTINGS
-- Fix: Technicians were only saved to localStorage, never persisted
-- ════════════════════════════════════════════════════════════════

-- Add technicians column to store standalone tech profiles
ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS technicians JSONB DEFAULT '[]';

-- Update existing row to have empty array if null
UPDATE app_settings
SET technicians = '[]'
WHERE technicians IS NULL;

COMMENT ON COLUMN app_settings.technicians IS
'Standalone technician profiles for job assignment (not user accounts). Merged with profiles table tech/contractor roles.';
