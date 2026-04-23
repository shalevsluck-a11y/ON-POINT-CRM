#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://nmmpemjcnncjfpooytpv.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjY4OTc3MiwiZXhwIjoyMDkyMjY1NzcyfQ.2YtvB-qcKyEPxmYRKzWcpK9f-vUZ5TFgRKGe0oJ_PZA';

const supabase = createClient(supabaseUrl, serviceRoleKey);

(async () => {
  console.log('='.repeat(60));
  console.log('COMPARING TEST PUSH VS REAL JOB PUSH');
  console.log('='.repeat(60));
  console.log('');

  // 1. Get push_logs for comparison
  console.log('1. PUSH_LOGS (last 10 events):');
  console.log('-'.repeat(60));
  const { data: logs, error: logsErr } = await supabase
    .from('push_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (logsErr) {
    console.error('Error fetching logs:', logsErr);
  } else {
    logs.forEach((log, i) => {
      console.log('');
      console.log(`Log #${i+1}: ${log.event_type} at ${log.created_at}`);
      console.log('Request:', JSON.stringify(log.request_body, null, 2));
      console.log('Recipients:', log.recipients);
      if (log.results && log.results.send_results) {
        console.log('Send results:');
        log.results.send_results.forEach(r => {
          console.log(`  - User ${r.user_id}: ${r.success ? '✅' : '❌'} HTTP ${r.status}, endpoint=${r.endpoint}`);
        });
      }
      console.log('Total sent:', log.results?.sent_count || 0, '/', log.results?.total_subscriptions || 0);
    });
  }

  // 2. Get all profiles to check roles
  console.log('');
  console.log('');
  console.log('2. PROFILES (all users with their roles):');
  console.log('-'.repeat(60));
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .order('created_at', { ascending: false });

  if (profErr) {
    console.error('Error fetching profiles:', profErr);
  } else {
    console.log(`Total profiles: ${profiles.length}`);
    profiles.forEach(p => {
      const roleStr = p.role || 'NULL/MISSING';
      const isAdminOrDispatcher = ['admin', 'dispatcher'].includes(p.role);
      const marker = isAdminOrDispatcher ? ' ✅ (eligible for job notifications)' : ' ❌ (NOT eligible - no admin/dispatcher role)';
      console.log(`  ${p.name || 'Unnamed'} (${p.email})`);
      console.log(`    role: ${roleStr}${marker}`);
      console.log(`    id: ${p.id}`);
    });
  }

  // 3. Get push subscriptions
  console.log('');
  console.log('');
  console.log('3. PUSH_SUBSCRIPTIONS (currently active):');
  console.log('-'.repeat(60));
  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, created_at')
    .order('created_at', { ascending: false });

  if (subsErr) {
    console.error('Error fetching subscriptions:', subsErr);
  } else {
    console.log(`Total subscriptions: ${subs.length}`);
    subs.forEach(s => {
      console.log(`  User ${s.user_id}:`);
      console.log(`    endpoint: ${s.endpoint.substring(0, 60)}...`);
      console.log(`    created: ${s.created_at}`);
    });
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('ANALYSIS:');
  console.log('='.repeat(60));
  console.log('');
  console.log('Manual test push uses:');
  console.log('  - targetUserId: <specific user ID>');
  console.log('  - NO broadcast/roles filtering');
  console.log('  - Sends to ALL subscriptions for that user');
  console.log('');
  console.log('Real job creation push uses:');
  console.log('  - broadcast: true');
  console.log('  - roles: [admin, dispatcher]');
  console.log('  - excludedUserId: <job creator ID>');
  console.log('  - Sends ONLY to users with admin/dispatcher role');
  console.log('  - EXCLUDES the user who created the job');
  console.log('');
  console.log('Check above: Does your iPhone user have admin or dispatcher role?');
  console.log('');

  process.exit(0);
})();
