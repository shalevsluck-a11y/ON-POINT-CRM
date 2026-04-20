/* ============================================================
   AUTH.JS — Authentication and session management
   Handles login/logout, role detection, session persistence
   ============================================================ */

const Auth = (() => {

  let _currentUser = null;  // { id, email, name, role, color, isOwner, ... }
  let _onAuthChange = null; // callback set by App

  // ──────────────────────────────────────────────────────────
  // INIT — call once on page load
  // ──────────────────────────────────────────────────────────

  async function init(onAuthChange) {
    _onAuthChange = onAuthChange;

    // Listen for auth state changes
    SupabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await _loadProfile(session.user);
      } else {
        _currentUser = null;
      }
      if (_onAuthChange) _onAuthChange(_currentUser);
    });

    // Check for existing session
    const { data: { session } } = await SupabaseClient.auth.getSession();
    if (session?.user) {
      await _loadProfile(session.user);
    }
    return _currentUser;
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
      id:          authUser.id,
      email:       authUser.email,
      name:        profile?.name || authUser.email,
      role:        profile?.role || 'tech',
      color:       profile?.color || '#3B82F6',
      phone:       profile?.phone || '',
      zelleHandle: profile?.zelle_handle || '',
      zipCodes:    profile?.zip_codes || [],
      techPercent: profile?.default_tech_percent || 60,
      isOwner:     profile?.is_owner || false,
    };
  }

  // ──────────────────────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────────────────────

  async function login(email, password) {
    const { data, error } = await SupabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // ──────────────────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────────────────

  async function logout() {
    await SupabaseClient.auth.signOut();
    _currentUser = null;
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
    const { data, error } = await SupabaseClient.rpc('get_users_for_admin');
    if (error) throw error;
    return data || [];
  }

  async function updateUserRole(userId, role) {
    if (!isAdmin()) throw new Error('Admin only');
    const { error } = await SupabaseClient
      .from('profiles')
      .update({ role })
      .eq('id', userId);
    if (error) throw error;
  }

  async function inviteUser(email, name, role) {
    if (!isAdmin()) throw new Error('Admin only');
    const { data: { session } } = await SupabaseClient.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email, name, role }),
    });
    let json;
    try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) throw new Error(json.error || 'Invite failed');
    return json;
  }

  async function removeUser(userId) {
    if (!isAdmin()) throw new Error('Admin only');
    const { data: { session } } = await SupabaseClient.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/remove-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId }),
    });
    let json;
    try { json = await res.json(); } catch { json = {}; }
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
    removeUser,
    savePushSubscription,
    deletePushSubscription,
  };

})();
