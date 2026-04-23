/* ============================================================
   SUPABASE-PUSH-CLIENT.JS — Server proxy for push subscriptions

   WHY: iOS Safari blocks direct Supabase connections
   SOLUTION: Use server endpoint with admin client
   ============================================================ */

/**
 * Save push subscription via server proxy (iOS-compatible)
 * WITH COMPREHENSIVE LOGGING for iOS PWA debugging
 */
async function savePushSubscriptionDirect(subscriptionData) {
  console.log('[PushClient] ========== START savePushSubscriptionDirect ==========');
  console.log('[PushClient] Timestamp:', new Date().toISOString());
  console.log('[PushClient] Running in standalone mode:', window.navigator.standalone);
  console.log('[PushClient] Current origin:', window.location.origin);
  console.log('[PushClient] Data:', JSON.stringify(subscriptionData, null, 2));

  try {
    console.log('[PushClient] Step 1: Building fetch request');
    const url = window.location.origin + '/api/save-push-subscription';
    console.log('[PushClient] Step 2: Full URL =', url);

    console.log('[PushClient] Step 3: Creating request options');
    const requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscriptionData)
    };
    console.log('[PushClient] Step 4: Request method:', requestOptions.method);
    console.log('[PushClient] Step 5: Request headers:', requestOptions.headers);
    console.log('[PushClient] Step 6: Request body length:', requestOptions.body.length);

    console.log('[PushClient] Step 7: About to call fetch()...');
    console.log('[PushClient] If this hangs, fetch is blocked in standalone mode');

    const response = await fetch(url, requestOptions);

    console.log('[PushClient] Step 8: Fetch returned!');
    console.log('[PushClient] Response status:', response.status);
    console.log('[PushClient] Response ok:', response.ok);
    console.log('[PushClient] Response type:', response.type);

    if (!response.ok) {
      console.error('[PushClient] Step 9: Response NOT OK');
      const errorData = await response.json().catch(() => ({ error: 'Could not parse error' }));
      console.error('[PushClient] Error data from server:', errorData);
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    console.log('[PushClient] Step 10: Parsing success response');
    const result = await response.json();
    console.log('[PushClient] Step 11: ✅ SUCCESS!');
    console.log('[PushClient] Result:', result);
    console.log('[PushClient] ========== END (SUCCESS) ==========');

    return result.data;

  } catch (err) {
    console.error('[PushClient] ========== EXCEPTION CAUGHT ==========');
    console.error('[PushClient] Error name:', err.name);
    console.error('[PushClient] Error message:', err.message);
    console.error('[PushClient] Error stack:', err.stack);
    console.error('[PushClient] Error constructor:', err.constructor.name);
    console.error('[PushClient] Is TypeError?:', err instanceof TypeError);
    console.error('[PushClient] Is NetworkError?:', err.name === 'NetworkError');
    console.error('[PushClient] ========== END (FAILED) ==========');
    throw err;
  }
}

// Expose globally
window.savePushSubscriptionDirect = savePushSubscriptionDirect;
