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
          role: authUser.user_metadata?.role || 'tech',
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
  // ADMIN: Create / manage users
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

  async function updateUserRole(userId, role) {
    if (!isAdmin()) throw new Error('Admin only');
    const { error } = await SupabaseClient
      .from('profiles')
      .update({ role })
      .eq('id', userId);
    if (error) throw error;
  }

  return {
    init,
    login,
    logout,
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
    updateUserRole,
  };

})();
