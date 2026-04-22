-- Add notification_preferences column to profiles table
-- Created: 2026-04-22 04:35 UTC

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
  "enabled": true,
  "sound": "chime",
  "newJob": true
}'::jsonb;

COMMENT ON COLUMN profiles.notification_preferences IS 'User notification preferences stored as JSON';
