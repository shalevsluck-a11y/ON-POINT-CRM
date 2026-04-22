-- Create test dispatcher user with Sonart Construction permission
-- This helps test the lead source filtering

DO $$
DECLARE
  dispatcher_id UUID;
  dispatcher_email TEXT;
  temp_password TEXT;
BEGIN
  -- Generate unique email
  dispatcher_email := 'dispatcher.' || floor(random() * 10000)::text || '@onpointprodoors.com';
  temp_password := encode(gen_random_bytes(16), 'base64');

  -- Create auth user
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    dispatcher_email,
    crypt(temp_password, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('name', 'Test Dispatcher'),
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  ) RETURNING id INTO dispatcher_id;

  -- Create profile with lead source permission
  INSERT INTO profiles (id, name, role, magic_token, allowed_lead_sources)
  VALUES (
    dispatcher_id,
    'Test Dispatcher',
    'dispatcher',
    'DISPATCHER-' || upper(substring(md5(random()::text) from 1 for 4)),
    ARRAY['Sonart Construction']
  );

  RAISE NOTICE 'Dispatcher created: %', dispatcher_email;
  RAISE NOTICE 'Magic token: %', (SELECT magic_token FROM profiles WHERE id = dispatcher_id);
END $$;
