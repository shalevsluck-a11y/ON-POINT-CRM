// Apply missing production migrations
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://api.onpointprodoors.com';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigrations() {
  console.log('📦 Applying production migrations...\n');

  // 1. Apply migration 041 - remote_debug_logs
  console.log('1️⃣  Applying 041_remote_debug_logs.sql');
  const migration041 = fs.readFileSync(
    path.join(__dirname, 'supabase/migrations/041_remote_debug_logs.sql'),
    'utf8'
  );

  const { error: error041 } = await supabase.rpc('exec_sql', { sql_query: migration041 });

  if (error041) {
    // Table might already exist, check if that's the error
    const { data: tableExists } = await supabase
      .from('remote_debug_logs')
      .select('id')
      .limit(1);

    if (tableExists !== null) {
      console.log('   ✅ remote_debug_logs table already exists');
    } else {
      console.error('   ❌ Failed to create remote_debug_logs:', error041.message);
    }
  } else {
    console.log('   ✅ Created remote_debug_logs table');
  }

  // 2. Check if push_notification_logs exists
  console.log('\n2️⃣  Checking push_notification_logs table');
  const { data: pushLogsExists, error: pushLogsError } = await supabase
    .from('push_notification_logs')
    .select('id')
    .limit(1);

  if (pushLogsError && pushLogsError.code === 'PGRST204') {
    console.log('   ⚠️  push_notification_logs table does not exist - skipping (not needed for remote debug)');
  } else if (pushLogsExists !== null) {
    console.log('   ✅ push_notification_logs table exists');
  }

  // 3. Verify tables exist
  console.log('\n3️⃣  Verifying tables in production');

  const { data: debugLogs, error: debugError } = await supabase
    .from('remote_debug_logs')
    .select('count')
    .limit(1);

  if (debugError) {
    console.error('   ❌ remote_debug_logs NOT accessible:', debugError.message);
  } else {
    console.log('   ✅ remote_debug_logs is accessible');
  }

  console.log('\n✅ Migration complete');
}

applyMigrations().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
