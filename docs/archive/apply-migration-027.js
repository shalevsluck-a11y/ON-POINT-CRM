// Apply migration 027 - Fix notification trigger job_id
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://api.onpointprodoors.com';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function applyMigration() {
  console.log('📖 Reading migration file...');
  const sql = fs.readFileSync('./supabase/migrations/027_fix_notification_trigger_job_id.sql', 'utf8');

  console.log('🚀 Applying migration 027...');
  console.log('SQL:', sql.substring(0, 200) + '...');

  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

  if (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }

  console.log('✅ Migration 027 applied successfully!');
  console.log('✅ Notification triggers now use NEW.job_id instead of NEW.id');
  console.log('✅ Jobs should now save correctly and trigger realtime events!');
}

applyMigration().catch(console.error);
