// Add magic tokens to all existing profiles
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://api.onpointprodoors.com';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function addMagicTokens() {
  console.log('Fetching all profiles...');

  // Get all profiles
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, email, magic_token');

  if (error) {
    console.error('Error fetching profiles:', error);
    process.exit(1);
  }

  console.log(`Found ${profiles.length} profiles`);

  let updated = 0;
  let skipped = 0;

  for (const profile of profiles) {
    if (profile.magic_token) {
      console.log(`✓ ${profile.name} already has magic token`);
      skipped++;
      continue;
    }

    // Generate magic token
    const magicToken = Math.random().toString(36).substring(2) +
                      Math.random().toString(36).substring(2) +
                      Date.now().toString(36);

    // Update profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ magic_token: magicToken })
      .eq('id', profile.id);

    if (updateError) {
      console.error(`✗ Failed to update ${profile.name}:`, updateError);
    } else {
      console.log(`✓ Added magic token to ${profile.name}`);
      updated++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}`);
}

addMagicTokens().catch(console.error);
