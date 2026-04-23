/* ============================================================
   SUPABASE-PUSH-CLIENT.JS — Separate client for push subscriptions

   WHY: Custom domain proxy doesn't save to push_subscriptions table
   SOLUTION: Direct connection to real Supabase for ONLY this table
   ============================================================ */

// Real Supabase project URL (bypasses broken proxy)
const PUSH_SUPABASE_URL = 'https://nmmpemjcnncjfpooytpv.supabase.co';
const PUSH_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODk3NzIsImV4cCI6MjA5MjI2NTc3Mn0.4Y8atq2axARopvt6_BlBfkyUQyrbuQyjYsUNit-MJwM';

// Create dedicated client for push subscriptions ONLY
const PushSupabaseClient = window.supabase.createClient(PUSH_SUPABASE_URL, PUSH_SUPABASE_ANON, {
  auth: {
    persistSession: false, // Don't persist - we'll use session from main client
    autoRefreshToken: false,
  },
  global: {
    headers: {
      'apikey': PUSH_SUPABASE_ANON,
    },
  },
});

/**
 * Save push subscription using the real Supabase endpoint
 * This bypasses the custom domain proxy that breaks push subscriptions
 *
 * NOTE: RLS is disabled on push_subscriptions table, so no auth needed
 */
async function savePushSubscriptionDirect(subscriptionData) {
  console.log('[PushClient] Saving subscription via direct Supabase connection');
  console.log('[PushClient] RLS disabled - using anon key only (no session needed)');
  console.log('[PushClient] Data:', JSON.stringify(subscriptionData, null, 2));

  // Save to push_subscriptions via direct connection
  // RLS is disabled, so anon key is sufficient
  const { data, error } = await PushSupabaseClient
    .from('push_subscriptions')
    .upsert(subscriptionData, {
      onConflict: 'user_id,endpoint'
    })
    .select();

  if (error) {
    console.error('[PushClient] Failed to save subscription:', error);
    console.error('[PushClient] Error details:', JSON.stringify(error, null, 2));
    throw error;
  }

  console.log('[PushClient] ✅ Subscription saved successfully via direct connection');
  console.log('[PushClient] Returned data:', data);

  return data;
}

// Expose globally
window.savePushSubscriptionDirect = savePushSubscriptionDirect;
