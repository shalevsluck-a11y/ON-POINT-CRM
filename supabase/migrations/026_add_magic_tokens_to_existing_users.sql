-- Add magic tokens to all existing profiles that don't have one
-- This fixes login for users created before magic token system

DO $$
DECLARE
    profile_record RECORD;
    new_token TEXT;
BEGIN
    FOR profile_record IN
        SELECT id, name FROM profiles WHERE magic_token IS NULL
    LOOP
        -- Generate unique magic token
        new_token := encode(gen_random_bytes(32), 'base64');

        -- Update profile with new magic token
        UPDATE profiles
        SET magic_token = new_token
        WHERE id = profile_record.id;

        RAISE NOTICE 'Added magic token to profile: %', profile_record.name;
    END LOOP;
END $$;

-- Log completion
DO $$
DECLARE
    count_updated INT;
BEGIN
    SELECT COUNT(*) INTO count_updated FROM profiles WHERE magic_token IS NOT NULL;
    RAISE NOTICE 'Total profiles with magic tokens: %', count_updated;
END $$;
