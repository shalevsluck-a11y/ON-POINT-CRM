/* ============================================================
   SUPABASE-PUSH-CLIENT.JS — Server proxy for push subscriptions

   WHY: iOS Safari blocks direct Supabase connections
   SOLUTION: Use server endpoint with admin client
   ============================================================ */

/**
 * Save push subscription via server proxy (iOS-compatible)
 * ✅ SECURITY FIX: Passes auth token, backend derives user_id
 */
async function savePushSubscriptionDirect(subscriptionData) {
  console.log('[PushClient] ========== START savePushSubscriptionDirect ==========');
  console.log('[PushClient] Timestamp:', new Date().toISOString());
  console.log('[PushClient] Running in standalone mode:', window.navigator.standalone);
  console.log('[PushClient] Current origin:', window.location.origin);

  try {
    // ✅ STEP 1: Get authenticated session token
    console.log('[PushClient] Step 1: Getting auth session...');
    const { data: sessionData, error: sessionError } = await SupabaseClient.auth.getSession();

    if (sessionError || !sessionData.session) {
      console.error('[PushClient] ❌ No authenticated session');
      throw new Error('Not authenticated - please log in');
    }

    const accessToken = sessionData.session.access_token;
    console.log('[PushClient] ✅ Got auth token (length:', accessToken.length, ')');

    // ✅ STEP 2: Build request with Authorization header (NOT user_id in body)
    const url = window.location.origin + '/api/save-push-subscription';
    console.log('[PushClient] Step 2: URL =', url);

    // Extract subscription fields ONLY (no user_id - backend derives it from token)
    const { endpoint, p256dh, auth_key } = subscriptionData;
    const requestBody = { endpoint, p256dh, auth_key };
    // ❌ user_id is NOT sent - backend derives it from auth token

    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`  // ✅ Auth token here
      },
      body: JSON.stringify(requestBody)
    };

    console.log('[PushClient] Step 3: Request with auth header (token redacted for security)');
    console.log('[PushClient] Step 4: Body contains:', Object.keys(requestBody).join(', '));
    console.log('[PushClient] Step 5: Calling fetch...');

    const response = await fetch(url, requestOptions);

    console.log('[PushClient] Step 6: Fetch returned! Status:', response.status);

    if (!response.ok) {
      console.error('[PushClient] ❌ Response NOT OK:', response.status);
      const errorData = await response.json().catch(() => ({ error: 'Could not parse error' }));
      console.error('[PushClient] Error from server:', errorData);
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log('[PushClient] ✅ SUCCESS! Backend derived user_id from auth token');
    console.log('[PushClient] Result:', result);
    console.log('[PushClient] ========== END (SUCCESS) ==========');

    return result.data;

  } catch (err) {
    console.error('[PushClient] ========== EXCEPTION ==========');
    console.error('[PushClient] Error:', err.message);
    console.error('[PushClient] Stack:', err.stack);
    console.error('[PushClient] ========== END (FAILED) ==========');
    throw err;
  }
}

// Expose globally
window.savePushSubscriptionDirect = savePushSubscriptionDirect;
