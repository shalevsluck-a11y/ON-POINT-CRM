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
    if (_isEnforcing) return;

    // Rate limit attempts (don't spam user)
    const now = Date.now();
    if (now - _lastAttempt < RETRY_INTERVAL) return;
    _lastAttempt = now;

    _isEnforcing = true;

    try {
      console.log('[Push Enforcer] Starting enforcement check');

      // Check if push is supported
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[Push Enforcer] Push not supported on this device');
        _isEnforcing = false;
        return;
      }

      // Check if user is logged in
      if (!Auth || !Auth.getUser || !Auth.getUser()) {
        console.log('[Push Enforcer] No user logged in, skipping');
        _isEnforcing = false;
        return;
      }

      // Check current permission state
      const permission = Notification.permission;
      console.log('[Push Enforcer] Current permission:', permission);

      if (permission === 'denied') {
        showDeniedBanner();
        _isEnforcing = false;
        return;
      }

      if (permission === 'default') {
        await showPermissionModal();
        _isEnforcing = false;
        return;
      }

      // Permission is 'granted' - ensure subscription exists
      if (permission === 'granted') {
        await ensureSubscribed();
        hideDeniedBanner();
        _isEnforcing = false;
        return;
      }

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
        btn.disabled = true;
        btn.textContent = 'Requesting permission...';

        try {
          const permission = await Notification.requestPermission();
          console.log('[Push Enforcer] Permission response:', permission);

          if (permission === 'granted') {
            btn.textContent = 'Subscribing...';
            await ensureSubscribed();
            modal.remove();
            resolve();
          } else {
            // User denied - show persistent banner instead
            modal.remove();
            showDeniedBanner();
            resolve();
          }
        } catch (error) {
          console.error('[Push Enforcer] Permission request failed:', error);
          btn.disabled = false;
          btn.textContent = 'Enable Notifications';
          btn.style.background = '#ef4444';
          btn.textContent = 'Try Again';
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
      console.log('[Push Enforcer] Ensuring subscription exists...');

      // Wait for service worker to be ready
      const registration = await navigator.serviceWorker.ready;
      console.log('[Push Enforcer] Service worker ready');

      // Check if subscription already exists
      let subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        console.log('[Push Enforcer] Existing subscription found');
        // Subscription exists - make sure it's saved to database
        await savePushSubscription(subscription);
        console.log('[Push Enforcer] ✅ Subscription verified and saved');
        return;
      }

      // No subscription - create one
      console.log('[Push Enforcer] No subscription found, creating new one...');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      console.log('[Push Enforcer] Subscription created, saving to database...');
      await savePushSubscription(subscription);
      console.log('[Push Enforcer] ✅ New subscription created and saved');

    } catch (error) {
      console.error('[Push Enforcer] Failed to ensure subscription:', error);
      throw error;
    }
  }

  /**
   * Save subscription to database (upsert)
   */
  async function savePushSubscription(sub) {
    const currentUser = Auth.getUser();
    if (!currentUser) {
      console.warn('[Push Enforcer] No user to save subscription for');
      return;
    }

    const { endpoint, keys } = sub.toJSON ? sub.toJSON() : sub;

    console.log('[Push Enforcer] Saving subscription for user:', currentUser.id);

    const { error } = await SupabaseClient.from('push_subscriptions').upsert({
      user_id:  currentUser.id,
      endpoint,
      p256dh:   keys.p256dh,
      auth_key: keys.auth,
    }, { onConflict: 'user_id,endpoint' });

    if (error) {
      console.error('[Push Enforcer] Failed to save subscription:', error);
      throw error;
    }

    console.log('[Push Enforcer] Subscription saved to database');
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

    // Run enforcement immediately on init
    setTimeout(() => enforce(), 1000);

    // Re-enforce when page becomes visible (iOS kills service workers)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('[Push Enforcer] Page visible, re-enforcing...');
        setTimeout(() => enforce(), 500);
      }
    });

    // Re-enforce when window regains focus
    window.addEventListener('focus', () => {
      console.log('[Push Enforcer] Window focused, re-enforcing...');
      setTimeout(() => enforce(), 500);
    });

    console.log('[Push Enforcer] Initialized successfully');
  }

  return {
    init,
    enforce,
  };
})();

// Expose globally
window.PushSubscriptionEnforcer = PushSubscriptionEnforcer;
