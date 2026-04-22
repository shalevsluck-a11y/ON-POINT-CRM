/* ============================================================
   AUTH.JS — Authentication and session management
   Handles login/logout, role detection, session persistence
   ============================================================ */

const Auth = (() => {

  let _currentUser = null;  // { id, email, name, role, color, isOwner, ... }
  let _onAuthChange = null; // callback set by App
  let _sessionHealthInterval = null;
  let _consecutiveRefreshFailures = 0;

  // ──────────────────────────────────────────────────────────
  // INIT — call once on page load
  // ──────────────────────────────────────────────────────────

  async function init(onAuthChange) {
    _onAuthChange = onAuthChange;

    // Listen for auth state changes
    SupabaseClient.auth.onAuthStateChange(async (event, session) => {
      try {
        if (session?.user) {
          await _loadProfile(session.user);
          _consecutiveRefreshFailures = 0;
        } else {
          _currentUser = null;
        }
      } catch (e) {
        console.error('Auth state change: profile load failed:', e.message);
        _currentUser = null;
      }
      if (_onAuthChange) _onAuthChange(_currentUser);
    });

    // Check for existing session
    try {
      const { data: { session } } = await SupabaseClient.auth.getSession();
      if (session?.user) {
        await _loadProfile(session.user);
        _startSessionHealthCheck();
        // CRITICAL: Call onAuthChange callback for existing session
        if (_onAuthChange) _onAuthChange(_currentUser);
      }
    } catch (e) {
      console.error('Auth.init: getSession failed:', e.message);
    }
    return _currentUser;
  }

  // ──────────────────────────────────────────────────────────
  // SESSION HEALTH CHECK — verify session is valid
  // ──────────────────────────────────────────────────────────
  // NOTE: Supabase autoRefreshToken handles token refresh automatically.
  // This check is primarily for monitoring - we never force logout.
  // Trust Supabase to manage the session lifecycle.

  function _startSessionHealthCheck() {
    if (_sessionHealthInterval) clearInterval(_sessionHealthInterval);

    _sessionHealthInterval = setInterval(async () => {
      try {
        const { data: { session }, error } = await SupabaseClient.auth.getSession();

        if (error || !session) {
          _consecutiveRefreshFailures++;
          console.warn(`Session health check: no session (count: ${_consecutiveRefreshFailures})`);

          // Try refreshing the session if it's missing
          // But DON'T force logout - let Supabase handle expiration
          if (_consecutiveRefreshFailures <= 3) {
            // Attempt refresh (Supabase will handle if refresh token is valid)
            const { error: refreshError } = await SupabaseClient.auth.refreshSession();
            if (!refreshError) {
              console.log('Session refreshed successfully');
              _consecutiveRefreshFailures = 0;
            } else {
              console.warn('Session refresh failed:', refreshError.message);
              // Don't logout - user might be offline, Supabase will handle expiration
            }
          } else {
            // After multiple failures, stop checking but DON'T logout
            // User will be logged out naturally when they try to use the app
            console.warn('Session health check: stopping after repeated failures (session may have expired)');
            _stopSessionHealthCheck();
          }
        } else {
          _consecutiveRefreshFailures = 0;
          // Session is healthy - no action needed
        }
      } catch (e) {
        console.error('Session health check error:', e);
        // Don't logout on errors - might just be network issues
      }
    }, 600000); // Every 10 minutes (600,000ms) - less aggressive than before
  }

  function _stopSessionHealthCheck() {
    if (_sessionHealthInterval) {
      clearInterval(_sessionHealthInterval);
      _sessionHealthInterval = null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // LOAD PROFILE from Supabase
  // ──────────────────────────────────────────────────────────

  async function _loadProfile(authUser) {
    const { data, error } = await SupabaseClient
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (error || !data) {
      // Profile not yet created (race condition) — create it
      const { data: newProfile } = await SupabaseClient
        .from('profiles')
        .upsert({
          id:   authUser.id,
          name: authUser.user_metadata?.name || authUser.email || '',
          role: 'tech',
        })
        .select()
        .single();
      _currentUser = _buildUser(authUser, newProfile);
    } else {
      _currentUser = _buildUser(authUser, data);
    }
  }

  function _buildUser(authUser, profile) {
    return {
      id:                authUser.id,
      email:             authUser.email,
      name:              profile?.name || authUser.email,
      role:              profile?.role || 'tech',
      color:             profile?.color || '#3B82F6',
      phone:             profile?.phone || '',
      zelleHandle:       profile?.zelle_handle || '',
      zipCodes:          profile?.zip_codes || [],
      techPercent:       profile?.default_tech_percent || 60,
      isOwner:           profile?.is_owner || false,
      assignedLeadSource: profile?.assigned_lead_source || null,
    };
  }

  // ──────────────────────────────────────────────────────────
  // LOGIN with automatic retry
  // ──────────────────────────────────────────────────────────

  async function login(email, password, onRetry) {
    let lastError = null;
    const maxRetries = 3;
    const retryDelays = [0, 3000, 3000]; // 0ms, 3s, 3s

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Notify UI of retry
          if (onRetry) onRetry(attempt);
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
        }

        const loginTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), 15000)
        );
        const loginAttempt = SupabaseClient.auth.signInWithPassword({ email, password }).then(({ data, error }) => {
          if (error) throw error;
          return data;
        });

        const result = await Promise.race([loginAttempt, loginTimeout]);
        _startSessionHealthCheck();
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`Login attempt ${attempt + 1}/${maxRetries} failed:`, error.message);
        if (attempt < maxRetries - 1) {
          console.log(`Retrying in ${retryDelays[attempt + 1] / 1000}s...`);
        }
      }
    }

    throw new Error(lastError?.message || 'CONNECTION_ERROR');
  }

  // ──────────────────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────────────────

  async function logout() {
    _stopSessionHealthCheck();
    await SupabaseClient.auth.signOut();
    _currentUser = null;
    _consecutiveRefreshFailures = 0;
  }

  // ──────────────────────────────────────────────────────────
  // SET PASSWORD (for invited users completing setup)
  // ──────────────────────────────────────────────────────────

  async function updatePassword(newPassword) {
    const { error } = await SupabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // ──────────────────────────────────────────────────────────
  // FIRST SETUP
  // ──────────────────────────────────────────────────────────

  async function checkFirstSetupNeeded() {
    const { data, error } = await SupabaseClient.rpc('is_first_setup_needed');
    if (error) throw error;
    return data === true;
  }

  async function completeFirstAdminSetup() {
    const { data, error } = await SupabaseClient.rpc('complete_first_admin_setup');
    if (error) throw error;
    if (!data) throw new Error('Setup failed — an admin already exists.');
    // Reload current user profile so role updates to admin
    const { data: { session } } = await SupabaseClient.auth.getSession();
    if (session?.user) await _loadProfile(session.user);
    return true;
  }

  // ──────────────────────────────────────────────────────────
  // GETTERS
  // ──────────────────────────────────────────────────────────

  function getUser()       { return _currentUser; }
  function getRole()       { return _currentUser?.role || null; }
  function isAdmin()       { return _currentUser?.role === 'admin'; }
  function isDispatcher()  { return _currentUser?.role === 'dispatcher'; }
  function isTech()        { return _currentUser?.role === 'tech'; }
  function isContractor()  { return _currentUser?.role === 'contractor'; }
  function isTechOrContractor() { return isTech() || isContractor(); }
  function isAdminOrDisp() { return isAdmin() || isDispatcher(); }
  function canSeeFinancials()  { return isAdmin(); }
  function canSeeZelleMemo()   { return isAdmin(); }
  function canCreateJobs()     { return isAdmin() || isDispatcher(); }
  function canEditAllJobs()    { return isAdmin() || isDispatcher(); }

  // ──────────────────────────────────────────────────────────
  // UPDATE PROFILE
  // ──────────────────────────────────────────────────────────

  async function updateProfile(updates) {
    if (!_currentUser) throw new Error('Not authenticated');
    const { error } = await SupabaseClient
      .from('profiles')
      .update(updates)
      .eq('id', _currentUser.id);
    if (error) throw error;
    // Refresh local user object
    Object.assign(_currentUser, {
      name:        updates.name        ?? _currentUser.name,
      phone:       updates.phone       ?? _currentUser.phone,
      zelleHandle: updates.zelle_handle ?? _currentUser.zelleHandle,
      color:       updates.color       ?? _currentUser.color,
    });
  }

  // ──────────────────────────────────────────────────────────
  // ADMIN: manage users
  // ──────────────────────────────────────────────────────────

  async function getAllProfiles() {
    if (!isAdmin()) throw new Error('Admin only');
    const { data, error } = await SupabaseClient
      .from('profiles')
      .select('*')
      .order('name');
    if (error) throw error;
    return data || [];
  }

  async function getUsersForAdmin() {
    if (!isAdmin()) throw new Error('Admin only');
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Users list timed out — check connection')), 20000)
    );
    const query = SupabaseClient.rpc('get_users_for_admin').then(({ data, error }) => {
      if (error) throw new Error(error.message || error.details || 'RPC error');
      return data || [];
    });
    return Promise.race([query, timeout]);
  }

  async function updateUserRole(userId, role, additionalFields = {}) {
    if (!isAdmin()) throw new Error('Admin only');
    const updateData = { role, ...additionalFields };
    const { error } = await SupabaseClient
      .from('profiles')
      .update(updateData)
      .eq('id', userId);
    if (error) throw error;
  }

  async function inviteUser(name, role, phone) {
    if (!isAdmin()) throw new Error('Admin only');
    const { data: { session } } = await SupabaseClient.auth.getSession();
    let res, json;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name, role, phone: phone || '' }),
      });
      clearTimeout(timer);
      json = await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Invite timed out — check connection');
      throw new Error('Network error — invite could not be sent');
    }
    if (!res.ok) throw new Error(json.error || 'Invite failed');
    return json; // { success, userId, setupLink, loginEmail }
  }

  async function createUser(name, email, password, role, assignedLeadSource = null, payoutPct = null) {
    if (!isAdmin()) throw new Error('Admin only');
    const { data: { session } } = await SupabaseClient.auth.getSession();
    let res, json;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const body = { name, email, password, role };
      if (assignedLeadSource) body.assigned_lead_source = assignedLeadSource;
      if (payoutPct !== null && payoutPct !== undefined && payoutPct !== '') body.payout_pct = parseFloat(payoutPct);
      res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      json = await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Create user timed out — check connection');
      throw new Error('Network error — user could not be created');
    }
    if (!res.ok) {
      const errorMsg = json?.error || json?.message || `User creation failed (HTTP ${res.status})`;
      console.error('Create user error:', errorMsg, 'Full response:', json);
      throw new Error(errorMsg);
    }
    return json; // { success, userId, email, name }
  }

  async function removeUser(userId) {
    if (!isAdmin()) throw new Error('Admin only');
    const { data: { session } } = await SupabaseClient.auth.getSession();
    let res, json;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      res = await fetch(`${SUPABASE_URL}/functions/v1/remove-user`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });
      clearTimeout(timer);
      json = await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out — check connection');
      throw new Error('Network error — user could not be removed');
    }
    if (!res.ok) throw new Error(json.error || 'Remove failed');
    return json;
  }

  // ──────────────────────────────────────────────────────────
  // PUSH NOTIFICATIONS
  // ──────────────────────────────────────────────────────────

  /**
   * Convert base64url string to Uint8Array for VAPID key
   * @param {string} base64String - VAPID public key in base64url format
   * @returns {Uint8Array} - Decoded key bytes
   * @private
   */
  function _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /**
   * Subscribe the current user to push notifications
   * Requests permission, registers service worker, saves subscription to DB
   * @returns {Promise<PushSubscription|null>} - Subscription object or null if denied/unavailable
   */
  async function subscribeToPush() {
    // VAPID public key for web push (from environment)
    const VAPID_PUBLIC_KEY = 'BGNE39yvpaok-a8Iqxe9Pf-7sfnQMq282TWZ0WvKcahkIJSdOFGGQq8od2yeB5CzYa3F0TQcdt0-GyvhV3SjAXo';

    if (!('serviceWorker' in navigator)) {
      console.warn('Push: Service workers not supported');
      return null;
    }

    if (!('PushManager' in window)) {
      console.warn('Push: Push messaging not supported');
      return null;
    }

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('Push: Permission denied');
        return null;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      // Save to database
      await savePushSubscription(subscription);
      console.log('Push: Subscription saved');
      return subscription;

    } catch (error) {
      console.warn('Push: Subscription failed:', error.message);
      return null;
    }
  }

  /**
   * Save a push notification subscription to the database
   * Called after user grants notification permission and service worker registers
   * @param {PushSubscription} sub - Browser push subscription object
   * @returns {Promise<void>}
   */
  async function savePushSubscription(sub) {
    if (!_currentUser) return;
    const { endpoint, keys } = sub.toJSON ? sub.toJSON() : sub;
    await SupabaseClient.from('push_subscriptions').upsert({
      user_id:  _currentUser.id,
      endpoint,
      p256dh:   keys.p256dh,
      auth_key: keys.auth,
    }, { onConflict: 'user_id,endpoint' });
  }

  /**
   * Delete a push notification subscription from the database
   * Called when user unsubscribes or subscription becomes invalid
   * @param {string} endpoint - Push subscription endpoint URL
   * @returns {Promise<void>}
   */
  async function deletePushSubscription(endpoint) {
    if (!_currentUser) return;
    await SupabaseClient.from('push_subscriptions')
      .delete()
      .eq('user_id', _currentUser.id)
      .eq('endpoint', endpoint);
  }

  return {
    init,
    login,
    logout,
    updatePassword,
    checkFirstSetupNeeded,
    completeFirstAdminSetup,
    getUser,
    getRole,
    isAdmin,
    isDispatcher,
    isTech,
    isContractor,
    isTechOrContractor,
    isAdminOrDisp,
    canSeeFinancials,
    canSeeZelleMemo,
    canCreateJobs,
    canEditAllJobs,
    updateProfile,
    getAllProfiles,
    getUsersForAdmin,
    updateUserRole,
    inviteUser,
    createUser,
    removeUser,
    subscribeToPush,
    savePushSubscription,
    deletePushSubscription,
  };

})();
