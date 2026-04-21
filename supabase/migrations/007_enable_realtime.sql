-- ============================================================
-- MIGRATION 007 — Enable Realtime for Profiles
-- ============================================================
-- This migration adds profiles to the realtime publication
-- so that role changes and profile updates can be received
-- in real-time across all connected clients.
-- ============================================================

-- Enable REPLICA IDENTITY FULL for profiles table
-- This allows DELETE events to include the full old row
ALTER TABLE profiles REPLICA IDENTITY FULL;

-- Add profiles table to realtime publication
-- Use DO block to handle duplicate_object gracefully
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
