// Check push subscriptions via Supabase admin client
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://api.onpointprodoors.com';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function checkSubscriptions() {
  console.log('Checking push subscriptions...\n');
  
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('user_id, endpoint, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Found', subs.length, 'subscriptions:\n');
  subs.forEach((sub, i) => {
    console.log(`${i + 1}. User: ${sub.user_id}`);
    console.log(`   Endpoint: ${sub.endpoint.substring(0, 60)}...`);
    console.log(`   Created: ${sub.created_at}\n`);
  });
  
  // Also check profiles to see roles
  const { data: profiles, error: profError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .in('role', ['admin', 'dispatcher']);
    
  if (!profError) {
    console.log('\nAdmin/Dispatcher users:');
    profiles.forEach(p => {
      const hasSub = subs.some(s => s.user_id === p.id);
      console.log(`- ${p.name} (${p.role}) - ${hasSub ? '✅ HAS subscription' : '❌ NO subscription'}`);
    });
  }
}

checkSubscriptions().then(() => process.exit(0));
