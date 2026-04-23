/* ============================================================
   SUPABASE-PUSH-CLIENT.JS — Server proxy for push subscriptions

   WHY: iOS Safari blocks direct Supabase connections
   SOLUTION: Use server endpoint with admin client
   ============================================================ */

/**
 * Save push subscription via server proxy (iOS-compatible)
 */
async function savePushSubscriptionDirect(subscriptionData) {
  console.log('[PushClient] Saving via server proxy at /api/save-push-subscription');
  console.log('[PushClient] Data:', JSON.stringify(subscriptionData, null, 2));

  const response = await fetch('/api/save-push-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscriptionData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    console.error('[PushClient] Server error:', errorData);
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  const result = await response.json();
  console.log('[PushClient] ✅ Subscription saved via server proxy');
  return result.data;
}

// Expose globally
window.savePushSubscriptionDirect = savePushSubscriptionDirect;
