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
  // SESSION HEALTH CHECK — refresh token every 4 minutes
  // ──────────────────────────────────────────────────────────

  function _startSessionHealthCheck() {
    if (_sessionHealthInterval) clearInterval(_sessionHealthInterval);

    _sessionHealthInterval = setInterval(async () => {
      try {
        const { data: { session }, error } = await SupabaseClient.auth.getSession();

        if (error || !session) {
          _consecutiveRefreshFailures++;
          console.warn(`Session health check failed (${_consecutiveRefreshFailures}/2)`);

          // Try refreshing the session
          if (_consecutiveRefreshFailures === 1) {
            setTimeout(async () => {
              const { error: retryError } = await SupabaseClient.auth.refreshSession();
              if (!retryError) {
                console.log('Session refreshed successfully on retry');
                _consecutiveRefreshFailures = 0;
              }
            }, 30000); // Retry after 30 seconds
          } else if (_consecutiveRefreshFailures >= 2) {
            // After 2 consecutive failures, force re-login
            console.error('Session health check failed twice - forcing re-login');
            _stopSessionHealthCheck();
            await logout();
          }
        } else {
          _consecutiveRefreshFailures = 0;
        }
      } catch (e) {
        console.error('Session health check error:', e);
      }
    }, 240000); // Every 4 minutes (240,000ms)
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

  async function login(email, password) {
    let lastError = null;
    const maxRetries = 3;
    const retryDelays = [0, 3000, 6000]; // 0ms, 3s, 6s

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
        }

        const loginTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Login timed out')), 10000)
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

    throw new Error(lastError?.message || 'Login failed after 3 attempts — check your connection');
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
    savePushSubscription,
    deletePushSubscription,
  };

})();
