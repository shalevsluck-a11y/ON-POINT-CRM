/**
 * PUSH SUBSCRIPTION ENFORCER
 * Forces EVERY user to subscribe to push notifications on EVERY device
 * Runs on: page load, login, focus, visibility change
 * No exceptions. No skipping. No silent failures.
 */

const PushSubscriptionEnforcer = (() => {
  const VAPID_PUBLIC_KEY = 'BNThACyKMai6hck9NCqpLf_Qdyx_qhpcqGCeOI-_qr1ZS-FyfSx1woTtR9ERYjXBtn8bT5u3am_dBvSADIy_oLc';

  let _isEnforcing = false;
  let _lastAttempt = 0;
  const RETRY_INTERVAL = 5000; // 5 seconds between retry attempts

  /**
   * Main enforcement function - runs everywhere, always
   */
  async function enforce() {
    // Prevent concurrent enforcement attempts
    if (_isEnforcing) {
      console.log('[Push Enforcer] Already enforcing, skipping');
      return;
    }

    // Rate limit attempts (don't spam user)
    const now = Date.now();
    if (now - _lastAttempt < RETRY_INTERVAL) {
      console.log('[Push Enforcer] Rate limited, skipping');
      return;
    }
    _lastAttempt = now;

    _isEnforcing = true;

    try {
      if (window.DebugPanel) {
        DebugPanel.log('SUBSCRIPTION', 'Starting push subscription check');
      }
      console.log('[Push Enforcer] ========== STARTING ENFORCEMENT ==========');

      // Check if push is supported
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[Push Enforcer] Push not supported on this device');
        console.warn('[Push Enforcer] serviceWorker:', 'serviceWorker' in navigator);
        console.warn('[Push Enforcer] PushManager:', 'PushManager' in window);
        _isEnforcing = false;
        return;
      }

      // Check if user is logged in
      const currentUser = Auth && Auth.getUser ? Auth.getUser() : null;
      if (!currentUser) {
        if (window.DebugPanel) {
          DebugPanel.log('SUBSCRIPTION', 'No user logged in, skipping');
        }
        console.log('[Push Enforcer] No user logged in, skipping enforcement');
        console.log('[Push Enforcer] Auth available:', !!Auth);
        console.log('[Push Enforcer] Auth.getUser available:', Auth && !!Auth.getUser);
        _isEnforcing = false;
        return;
      }

      if (window.DebugPanel) {
        DebugPanel.log('SUBSCRIPTION', `User logged in: ${currentUser.name} (${currentUser.role})`, { userId: currentUser.id });
      }
      console.log('[Push Enforcer] Running for:', currentUser.name || currentUser.email, 'role:', currentUser.role, 'id:', currentUser.id);

      // Check current permission state
      const permission = Notification.permission;
      console.log('[Push Enforcer] Current permission:', permission);

      if (permission === 'denied') {
        console.log('[Push Enforcer] Permission DENIED - showing banner');
        showDeniedBanner();
        _isEnforcing = false;
        return;
      }

      if (permission === 'default') {
        console.log('[Push Enforcer] Permission DEFAULT - showing modal');
        await showPermissionModal();
        console.log('[Push Enforcer] Permission modal completed, new permission:', Notification.permission);
        _isEnforcing = false;

        // Re-enforce immediately if permission was granted
        if (Notification.permission === 'granted') {
          console.log('[Push Enforcer] Permission just granted, re-running enforcement...');
          _lastAttempt = 0; // Reset rate limit
          setTimeout(() => enforce(), 100);
        }
        return;
      }

      // Permission is 'granted' - ensure subscription exists
      if (permission === 'granted') {
        console.log('[Push Enforcer] Permission GRANTED - ensuring subscription...');
        await ensureSubscribed();
        hideDeniedBanner();
        _isEnforcing = false;
        return;
      }

      console.warn('[Push Enforcer] Unknown permission state:', permission);

    } catch (error) {
      console.error('[Push Enforcer] Error:', error);
      _isEnforcing = false;
    }
  }

  /**
   * Show BLOCKING modal that user cannot dismiss without choosing
   */
  async function showPermissionModal() {
    return new Promise((resolve) => {
      // Remove existing modal if any
      const existing = document.getElementById('push-permission-modal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'push-permission-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      `;

      modal.innerHTML = `
        <div style="
          background: white;
          border-radius: 16px;
          padding: 32px;
          max-width: 400px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        ">
          <div style="font-size: 48px; margin-bottom: 16px;">🔔</div>
          <h2 style="margin: 0 0 12px 0; font-size: 24px; color: #0f172a;">Job Notifications Required</h2>
          <p style="margin: 0 0 24px 0; color: #64748b; font-size: 15px; line-height: 1.6;">
            You must enable notifications to use this app.<br>
            <strong style="color: #ef4444;">You will miss new jobs if you skip this.</strong>
          </p>
          <button id="enable-push-btn" style="
            width: 100%;
            padding: 16px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
          ">Enable Notifications</button>
        </div>
      `;

      document.body.appendChild(modal);

      const btn = document.getElementById('enable-push-btn');
      btn.onclick = async () => {
        console.log('[Push Enforcer] Enable button clicked');
        btn.disabled = true;
        btn.textContent = 'Requesting permission...';

        try {
          console.log('[Push Enforcer] Calling Notification.requestPermission()...');
          const permission = await Notification.requestPermission();
          console.log('[Push Enforcer] Permission response:', permission);

          if (permission === 'granted') {
            console.log('[Push Enforcer] Permission GRANTED! Creating subscription...');
            btn.textContent = 'Subscribing...';

            // Add timeout to prevent infinite hang
            const subscriptionPromise = ensureSubscribed();
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Subscription timeout after 30s')), 30000);
            });

            await Promise.race([subscriptionPromise, timeoutPromise]);

            console.log('[Push Enforcer] Subscription complete, closing modal');
            modal.remove();
            resolve();
          } else {
            // User denied - show persistent banner instead
            console.log('[Push Enforcer] Permission NOT granted (denied or default), showing banner');
            modal.remove();
            showDeniedBanner();
            resolve();
          }
        } catch (error) {
          console.error('[Push Enforcer] Permission request FAILED:', error);
          console.error('[Push Enforcer] Error message:', error.message);
          console.error('[Push Enforcer] Error stack:', error.stack);
          btn.disabled = false;
          btn.style.background = '#ef4444';
          btn.textContent = 'Error: ' + (error.message || 'Unknown error');

          // Auto re-enable after 3 seconds
          setTimeout(() => {
            btn.disabled = false;
            btn.style.background = '#2563eb';
            btn.textContent = 'Try Again';
          }, 3000);
        }
      };
    });
  }

  /**
   * Show persistent banner for denied permission
   */
  function showDeniedBanner() {
    // Remove existing banner if any
    const existing = document.getElementById('push-denied-banner');
    if (existing) return; // Already showing

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

    const banner = document.createElement('div');
    banner.id = 'push-denied-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      padding: 12px 16px;
      z-index: 9999;
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;

    if (isIOS) {
      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 24px;">⚠️</span>
          <div style="flex: 1;">
            <strong>Notifications Blocked</strong><br>
            <span style="font-size: 13px; opacity: 0.95;">
              iPhone: Settings → Safari → ${window.location.hostname} → Notifications → Allow
            </span>
          </div>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 24px;">⚠️</span>
          <div style="flex: 1;">
            <strong>Notifications Blocked</strong><br>
            <span style="font-size: 13px; opacity: 0.95;">
              Click the 🔒 or ⓘ icon in your browser's address bar → Allow notifications
            </span>
          </div>
        </div>
      `;
    }

    document.body.prepend(banner);
  }

  /**
   * Hide the denied banner
   */
  function hideDeniedBanner() {
    const banner = document.getElementById('push-denied-banner');
    if (banner) banner.remove();
  }

  /**
   * Ensure user has an active push subscription
   * This is where the actual subscription happens
   */
  async function ensureSubscribed() {
    try {
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '📡 Checking for existing subscription...');
      console.log('[Push Enforcer] Ensuring subscription exists...');

      // Check service worker state BEFORE waiting
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '🔍 Checking service worker state...');
      const swRegistration = await navigator.serviceWorker.getRegistration();
      if (!swRegistration) {
        if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', 'No service worker registered', null, true);
        throw new Error('Service worker not registered');
      }

      if (window.DebugPanel) DebugPanel.log('SW', `State: installing=${!!swRegistration.installing}, waiting=${!!swRegistration.waiting}, active=${!!swRegistration.active}`);

      if (swRegistration.active) {
        if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '✅ Service worker already active');
      } else {
        if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '⏳ Waiting for service worker to activate...');
      }

      // Wait for service worker to be ready (with timeout)
      const readyTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Service worker ready timeout after 10s')), 10000);
      });

      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        readyTimeout
      ]);

      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '✅ Service worker ready');
      console.log('[Push Enforcer] Service worker ready');

      // Check if subscription already exists
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '🔍 Checking existing subscription...');
      let subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '✅ Found existing subscription');
        console.log('[Push Enforcer] Existing subscription found');
        // Subscription exists - make sure it's saved to database
        await savePushSubscription(subscription);
        console.log('[Push Enforcer] ✅ Subscription verified and saved');
        return;
      }

      // No subscription - create one
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '⚠️ No subscription found');
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '🆕 Creating new push subscription...');
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '⏳ This may take a moment on iOS...');
      console.log('[Push Enforcer] No subscription found, creating new one...');

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '✅ Subscription created!');
      console.log('[Push Enforcer] Subscription created, saving to database...');
      await savePushSubscription(subscription);
      console.log('[Push Enforcer] ✅ New subscription created and saved');

    } catch (error) {
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', `Subscription failed: ${error.name}`, { error: error.message }, true);
      console.error('[Push Enforcer] Failed to ensure subscription:', error);
      throw error;
    }
  }

  /**
   * Save subscription to database (upsert)
   */
  async function savePushSubscription(sub) {
    console.log('[Push Enforcer] ========== savePushSubscription START ==========');

    const currentUser = Auth.getUser();
    console.log('[Push Enforcer] Current user:', currentUser);

    if (!currentUser) {
      console.error('[Push Enforcer] ❌ No user to save subscription for');
      return;
    }

    console.log('[Push Enforcer] User ID:', currentUser.id);
    console.log('[Push Enforcer] User name:', currentUser.name);

    const { endpoint, keys } = sub.toJSON ? sub.toJSON() : sub;

    console.log('[Push Enforcer] Push subscription endpoint:', endpoint.substring(0, 50) + '...');
    console.log('[Push Enforcer] Keys present - p256dh:', !!keys.p256dh, 'auth:', !!keys.auth);

    const data = {
      user_id:  currentUser.id,
      endpoint,
      p256dh:   keys.p256dh,
      auth_key: keys.auth,
    };

    // CRITICAL: Validate UUID format before sending to server
    if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '🔍 Validating user ID format...');
    console.log('[Push Enforcer] Validating user_id format...');
    console.log('[Push Enforcer] user_id type:', typeof data.user_id);
    console.log('[Push Enforcer] user_id value:', data.user_id);
    console.log('[Push Enforcer] user_id length:', data.user_id?.length);

    // UUID regex: 8-4-4-4-12 hex characters with hyphens
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isValidUUID = uuidRegex.test(data.user_id);

    console.log('[Push Enforcer] Is valid UUID?', isValidUUID);

    if (!isValidUUID) {
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', `Invalid user ID: ${data.user_id}`, null, true);
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', 'Expected UUID format like: 12345678-1234-1234-1234-123456789abc', null, true);
      console.error('[Push Enforcer] ❌ INVALID USER ID FORMAT');
      console.error('[Push Enforcer] Expected: UUID (e.g., "123e4567-e89b-12d3-a456-426614174000")');
      console.error('[Push Enforcer] Received:', data.user_id);
      console.error('[Push Enforcer] Current user object:', JSON.stringify(currentUser, null, 2));

      // Show user-friendly error
      alert('Cannot subscribe to notifications: Invalid user ID format. Please log out and log in again.');
      throw new Error(`Invalid user_id format: "${data.user_id}" is not a UUID`);
    }

    if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '✅ UUID valid - sending to server...');
    console.log('[Push Enforcer] ✅ UUID validation passed');
    console.log('[Push Enforcer] Prepared data for server:', JSON.stringify(data, null, 2));
    console.log('[Push Enforcer] About to call window.savePushSubscriptionDirect...');
    console.log('[Push Enforcer] Function exists?', typeof window.savePushSubscriptionDirect);

    if (!window.savePushSubscriptionDirect) {
      console.error('[Push Enforcer] ❌ window.savePushSubscriptionDirect is not defined!');
      throw new Error('savePushSubscriptionDirect function not loaded');
    }

    console.log('[Push Enforcer] Calling window.savePushSubscriptionDirect NOW...');

    try {
      const result = await window.savePushSubscriptionDirect(data);
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', '✅ SUCCESS! Subscription saved to database');
      console.log('[Push Enforcer] ✅ window.savePushSubscriptionDirect returned successfully');
      console.log('[Push Enforcer] Result:', result);
      console.log('[Push Enforcer] ========== savePushSubscription END (SUCCESS) ==========');
      return result;
    } catch (err) {
      if (window.DebugPanel) DebugPanel.log('SUBSCRIPTION', `Save failed: ${err.message}`, null, true);
      console.error('[Push Enforcer] ❌ window.savePushSubscriptionDirect FAILED');
      console.error('[Push Enforcer] Error:', err);
      console.error('[Push Enforcer] Error message:', err.message);
      console.error('[Push Enforcer] Error stack:', err.stack);
      console.error('[Push Enforcer] ========== savePushSubscription END (FAILED) ==========');
      throw err;
    }
  }

  /**
   * Convert VAPID public key to Uint8Array
   */
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
  }

  /**
   * Initialize enforcement - set up all listeners
   */
  function init() {
    console.log('[Push Enforcer] Initializing...');
    console.log('[Push Enforcer] Current user:', Auth ? Auth.getUser() : 'Auth not available');
    console.log('[Push Enforcer] Push supported:', 'serviceWorker' in navigator && 'PushManager' in window);
    console.log('[Push Enforcer] Notification permission:', Notification.permission);

    // Run enforcement IMMEDIATELY - no delay
    enforce().then(() => {
      console.log('[Push Enforcer] Initial enforcement complete');
    }).catch(err => {
      console.error('[Push Enforcer] Initial enforcement failed:', err);
    });

    // Re-enforce when page becomes visible (iOS kills service workers)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('[Push Enforcer] Page visible, re-enforcing...');
        enforce();
      }
    });

    // Re-enforce when window regains focus
    window.addEventListener('focus', () => {
      console.log('[Push Enforcer] Window focused, re-enforcing...');
      enforce();
    });

    // Re-enforce every 30 seconds if permission is still default
    setInterval(() => {
      if (Notification.permission === 'default' && Auth && Auth.getUser()) {
        console.log('[Push Enforcer] Periodic check - permission still default, re-enforcing...');
        enforce();
      }
    }, 30000);

    console.log('[Push Enforcer] Initialized successfully');
  }

  return {
    init,
    enforce,
  };
})();

// Expose globally
window.PushSubscriptionEnforcer = PushSubscriptionEnforcer;
