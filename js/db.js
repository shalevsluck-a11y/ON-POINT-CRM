/* ============================================================
   DB.JS — Supabase database layer with localStorage cache
   Hybrid approach: reads from cache (fast), writes to both.
   localStorage is kept in sync as the working cache.
   ============================================================ */

const DB = (() => {

  const supa = SupabaseClient;

  // ──────────────────────────────────────────────────────────
  // INIT — pull all data from Supabase into localStorage
  // ──────────────────────────────────────────────────────────

  async function init() {
    await Promise.all([_syncJobsDown(), _syncSettingsDown()]);
  }

  async function _syncJobsDown() {
    try {
      // Use server endpoint (reads from correct project)
      const { data: { session } } = await supa.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No auth session');
      }

      const response = await fetch('/api/load-jobs', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      const { jobs: data, zelleMap, role } = await response.json();

      console.log('[DB._syncJobsDown] ✅ Loaded from server:', data.length, 'jobs');

      const isAdmin = role === 'admin';
      const isTechLike = role === 'tech' || role === 'contractor';
      const jobs = (data || []).map(row => _dbRowToJob(row, zelleMap, isAdmin, isTechLike));
      Storage.saveJobs(jobs);
    } catch (e) {
      console.warn('DB._syncJobsDown error (using cache):', e.message);
    }
  }

  async function _syncSettingsDown() {
    console.log('[DB._syncSettingsDown] ========== START SYNC ==========');
    try {
      // Use server endpoint (reads from correct project)
      const { data: { session } } = await supa.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No auth session');
      }

      const response = await fetch('/api/load-settings', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      const { settings, profiles: techs, isAdmin } = await response.json();

      console.log('[DB._syncSettingsDown] ✅ Loaded from server');
      console.log('[DB._syncSettingsDown] Lead sources from DB:', settings.lead_sources);
      console.log('[DB._syncSettingsDown] Profiles count:', techs?.length || 0);

      const current = Storage.getSettings();
      console.log('[DB._syncSettingsDown] Current cached settings:', current);
      console.log('[DB._syncSettingsDown] Current cached leadSources:', current.leadSources);
      console.log('[DB._syncSettingsDown] User is admin?', isAdmin);

      // Build technician list from two sources:
      // 1. User profiles with tech/contractor role
      // 2. Standalone technician profiles from app_settings.technicians
      const userTechs = (techs || []).filter(t => t.role === 'tech' || t.role === 'contractor').map(t => ({
        id:        t.id,
        name:      t.name,
        phone:     t.phone,
        color:     t.color || '#3B82F6',
        zipCodes:  t.zip_codes || [],
        percent:   t.default_tech_percent || 60,
        zelle:     isAdmin ? (t.zelle_handle || '') : '',
        isOwner:   t.is_owner || false,
        role:      t.role,
        isUserAccount: true,
      }));

      // Get standalone technicians from database (non-user profiles)
      // SAFETY: Only use DB value if it's a valid array. Otherwise preserve cached standalone techs.
      let standaloneTechs;
      if (Array.isArray(settings.technicians)) {
        standaloneTechs = settings.technicians;
      } else {
        // DB field missing/invalid - preserve existing standalone techs from cache
        const cachedTechs = current.technicians || [];
        standaloneTechs = cachedTechs.filter(t => !t.isUserAccount);
        console.warn('[DB._syncSettingsDown] ⚠️  technicians field missing/invalid in DB, preserving cache');
      }

      console.log('[DB._syncSettingsDown] ╔══════════════════════════════════════════════════════════');
      console.log('[DB._syncSettingsDown] ║ TECHNICIAN LOAD FROM DATABASE');
      console.log('[DB._syncSettingsDown] ║ DB field valid?', Array.isArray(settings.technicians));
      console.log('[DB._syncSettingsDown] ║ Standalone techs:', standaloneTechs.length);
      console.log('[DB._syncSettingsDown] ║ Standalone tech data:', JSON.stringify(standaloneTechs));
      console.log('[DB._syncSettingsDown] ║ User account techs:', userTechs.length);
      console.log('[DB._syncSettingsDown] ╚══════════════════════════════════════════════════════════');

      // Merge both lists - user accounts first, then standalone techs
      const techList = [...userTechs, ...standaloneTechs];
      console.log('[DB._syncSettingsDown] Built tech list - users:', userTechs.length, 'standalone:', standaloneTechs.length, 'total:', techList.length);
      console.log('[DB._syncSettingsDown] ⚠️  ABOUT TO OVERWRITE LOCALSTORAGE WITH THIS TECH LIST');
      console.log('[DB._syncSettingsDown] Final tech list:', JSON.stringify(techList));

      const newSettings = {
        ...current,
        ownerName:      settings.owner_name      ?? current.ownerName     ?? '',
        ownerPhone:     settings.owner_phone     ?? current.ownerPhone    ?? '',
        ownerZelle:     isAdmin ? (settings.owner_zelle ?? current.ownerZelle ?? '') : '',
        taxRateNY:      settings.tax_rate_ny     ?? current.taxRateNY     ?? 8.875,
        taxRateNJ:      settings.tax_rate_nj     ?? current.taxRateNJ     ?? 6.625,
        defaultState:   settings.default_state   ?? current.defaultState  ?? 'NY',
        appsScriptUrl:  settings.apps_script_url ?? current.appsScriptUrl ?? '',
        leadSources:    settings.lead_sources    ?? current.leadSources   ?? [],
        technicians:    techList,
      };

      console.log('[DB._syncSettingsDown] About to save new settings to Storage...');
      console.log('[DB._syncSettingsDown] New leadSources value:', newSettings.leadSources);
      Storage.saveSettings(newSettings);
      console.log('[DB._syncSettingsDown] ✓ Settings saved to Storage');

      // Verify it was actually saved
      const verification = Storage.getSettings();
      console.log('[DB._syncSettingsDown] VERIFICATION - Settings after save:', verification);
      console.log('[DB._syncSettingsDown] VERIFICATION - leadSources after save:', verification.leadSources);
      console.log('[DB._syncSettingsDown] ========== END SYNC SUCCESS ==========');
    } catch (e) {
      console.error('[DB._syncSettingsDown] ========== ERROR ==========');
      console.error('[DB._syncSettingsDown] Error message:', e.message);
      console.error('[DB._syncSettingsDown] Error stack:', e.stack);
      console.warn('DB._syncSettingsDown error (using cache):', e.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // JOBS — read (from cache, fast)
  // ──────────────────────────────────────────────────────────

  function getJobs()                 { return Storage.getJobs(); }
  function getJobById(id)            { return Storage.getJobById(id); }
  function getJobsByDate(date)       { return Storage.getJobsByDate(date); }
  function getJobsByFilter(filter)   { return Storage.getJobsByFilter(filter); }
  function searchJobs(q)             { return Storage.searchJobs(q); }
  function detectReturningCustomer(p){ return Storage.detectReturningCustomer(p); }

  // ──────────────────────────────────────────────────────────
  // JOBS — write (cache + Supabase async)
  // ──────────────────────────────────────────────────────────

  async function saveJob(job) {
    console.log('[DB] saveJob START - Job ID:', job.jobId, 'Customer:', job.customerName);
    // Write to cache immediately
    Storage.saveJob(job);
    console.log('[DB] saveJob - Saved to localStorage');
    // Push to Supabase in background
    _upsertJobRemote(job)
      .then(() => console.log('[DB] saveJob - Synced to Supabase SUCCESS for job', job.jobId))
      .catch(e => console.error('[DB] saveJob remote error:', e.message, e));
    return job;
  }

  async function _upsertJobRemote(job) {
    console.log('[DB] _upsertJobRemote - Starting for job', job.jobId);

    // Use server endpoint (bypasses custom domain routing to correct project)
    const { data: { session } } = await supa.auth.getSession();
    if (!session?.access_token) {
      throw new Error('No auth session');
    }

    const response = await fetch('/api/save-job', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ job }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[DB] _upsertJobRemote - Save FAILED:', result);
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    console.log('[DB] _upsertJobRemote - Save SUCCESS:', job.jobId);

    // Send push notification for NEW jobs (check if data returned)
    if (result.data) {
      const createdAt = new Date(result.data.created_at).getTime();
      const updatedAt = new Date(result.data.updated_at).getTime();
      const isNewJob = Math.abs(createdAt - updatedAt) < 5000;

      if (isNewJob) {
        console.log('[DB] New job detected, sending push notification');
        _sendJobNotification(job.jobId, job.customerName).catch(err => {
          console.error('[DB] Push notification failed (non-blocking):', err);
        });
      }
    }
  }

  async function _sendJobNotification(jobId, customerName) {
    try {
      const { data: { session } } = await supa.auth.getSession();
      if (!session?.access_token) {
        console.warn('[DB] No auth session, skipping push notification');
        return;
      }

      console.log('[DB] Calling Edge Function for job notification:', jobId);
      const response = await fetch('https://api.onpointprodoors.com/functions/v1/send-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          broadcast: true,
          roles: ['admin', 'dispatcher'],
          title: 'New Job Added',
          body: `Job #${jobId} - ${customerName || 'Customer'}`,
          jobId: jobId
        })
      });

      const result = await response.json();
      console.log('[DB] Push notification response:', response.status, result);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.error('[DB] Push notification error:', err.message);
      // Don't throw - notification failure should not block job creation
    }
  }

  async function deleteJob(jobId) {
    Storage.deleteJob(jobId);

    // Use server endpoint (deletes from correct project)
    try {
      const { data: { session } } = await supa.auth.getSession();
      if (!session?.access_token) {
        console.warn('DB.deleteJob: No auth session');
        return;
      }

      const response = await fetch(`/api/delete-job/${jobId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const result = await response.json();
        console.warn('DB.deleteJob remote error:', result.error);
      }
    } catch (error) {
      console.warn('DB.deleteJob remote error:', error.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // SETTINGS — read/write
  // ──────────────────────────────────────────────────────────

  function getSettings() { return Storage.getSettings(); }

  async function saveSettings(updates) {
    Storage.saveSettings(updates);
    if (!Auth.isAdmin()) return;

    const row = {};
    if (updates.ownerName      !== undefined) row.owner_name      = updates.ownerName;
    if (updates.ownerPhone     !== undefined) row.owner_phone     = updates.ownerPhone;
    if (updates.ownerZelle     !== undefined) row.owner_zelle     = updates.ownerZelle;
    if (updates.taxRateNY      !== undefined) row.tax_rate_ny     = updates.taxRateNY;
    if (updates.taxRateNJ      !== undefined) row.tax_rate_nj     = updates.taxRateNJ;
    if (updates.defaultState   !== undefined) row.default_state   = updates.defaultState;
    if (updates.appsScriptUrl  !== undefined) row.apps_script_url = updates.appsScriptUrl;
    if (updates.leadSources    !== undefined) row.lead_sources    = updates.leadSources;

    // NOTE: Technicians are saved via Edge Function only (update-technicians)
    // Do NOT save via this path - PostgREST has stale schema cache for technicians column

    // Save all fields (except technicians)
    if (Object.keys(row).length > 0) {
      console.log('[DB.saveSettings] Saving to database:', Object.keys(row));
      const { error } = await supa.from('app_settings').update(row).eq('id', 1);
      if (error) throw new Error(error.message);
      console.log('[DB.saveSettings] ✓ Saved successfully');
    }
  }

  // Update settings in localStorage cache without remote sync
  function updateSettingsCache(settings) {
    Storage.saveSettings(settings);
  }

  async function updateTechProfile(id, profileData) {
    if (!Auth.isAdmin()) return;
    const row = {};
    if (profileData.name     !== undefined) row.name                 = profileData.name;
    if (profileData.phone    !== undefined) row.phone                = profileData.phone;
    if (profileData.color    !== undefined) row.color                = profileData.color;
    if (profileData.percent  !== undefined) row.default_tech_percent = profileData.percent;
    if (profileData.zelle    !== undefined) row.zelle_handle         = profileData.zelle;
    if (profileData.zipCodes !== undefined) row.zip_codes            = profileData.zipCodes;
    if (profileData.isOwner  !== undefined) row.is_owner             = profileData.isOwner;
    if (Object.keys(row).length === 0) return;
    const { error } = await supa.from('profiles').update(row).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function deleteProfile(id) {
    if (!Auth.isAdmin()) throw new Error('Admin only');
    const { error } = await supa.from('profiles').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // Delegate all other Storage methods
  function getOwnerTech()         { return Storage.getOwnerTech(); }
  function getTechById(id)        { return Storage.getTechById(id); }
  function getSourceById(id)      { return Storage.getSourceById(id); }
  function saveDraft(d)           { return Storage.saveDraft(d); }
  function getDraft()             { return Storage.getDraft(); }
  function clearDraft()           { return Storage.clearDraft(); }
  function getSyncQueue()         { return Storage.getSyncQueue(); }
  function addToSyncQueue(id)     { return Storage.addToSyncQueue(id); }
  function removeFromSyncQueue(id){ return Storage.removeFromSyncQueue(id); }
  function clearSyncQueue()       { return Storage.clearSyncQueue(); }
  function saveUndo(s)            { return Storage.saveUndo(s); }
  function getUndo()              { return Storage.getUndo(); }
  function clearUndo()            { return Storage.clearUndo(); }
  function generateId()           { return Storage.generateId(); }

  function exportAll() {
    return {
      jobs:       Storage.getJobs(),
      settings:   Storage.getSettings(),
      exportedAt: new Date().toISOString(),
      version:    '2.0',
    };
  }

  // ──────────────────────────────────────────────────────────
  // REAL-TIME — subscribe to live job changes with role-based filtering
  // ──────────────────────────────────────────────────────────

  function subscribeToJobs(onInsert, onUpdate, onDelete, onStatusChange) {
    const user = Auth.getUser();
    if (!user) return null;

    const channel = supa.channel('public:jobs');

    // Everyone sees all jobs (admin + dispatcher only)
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, payload => {
        console.log('[Realtime] ✅ INSERT:', payload.new.job_id, payload.new.customer_name);
        if (window.DebugPanel && typeof DebugPanel.log === 'function') {
          try {
            DebugPanel.log('PUSH', 'Job INSERT detected', { id: payload.new.job_id, customer: payload.new.customer_name });
          } catch (e) { console.warn('[Debug] log failed:', e); }
        }
        const job = _dbRowToJob(payload.new, {}, true, false);
        Storage.saveJob(job);

        // FIX 1: Don't play sound/notify if I created this job
        const currentUser = Auth.getUser();
        if (currentUser && payload.new.created_by === currentUser.id) {
          console.log('[Realtime] Skipping notification - I created this job');
          return;
        }

        if (onInsert) onInsert(job);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, payload => {
        console.log('[Realtime] ✏️ UPDATE:', payload.new.job_id, payload.new.customer_name);
        if (window.DebugPanel && typeof DebugPanel.log === 'function') {
          try {
            DebugPanel.log('PUSH', 'Job UPDATE detected', { id: payload.new.job_id, customer: payload.new.customer_name });
          } catch (e) { console.warn('[Debug] log failed:', e); }
        }
        const job = _dbRowToJob(payload.new, {}, true, false);
        Storage.saveJob(job);
        if (onUpdate) onUpdate(job);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'jobs' }, payload => {
        console.log('[Realtime] ❌ DELETE:', payload.old?.job_id);
        if (window.DebugPanel && typeof DebugPanel.log === 'function') {
          try {
            DebugPanel.log('PUSH', 'Job DELETE detected', { id: payload.old?.job_id });
          } catch (e) { console.warn('[Debug] log failed:', e); }
        }
        const jobId = payload.old?.job_id;
        if (jobId) {
          Storage.deleteJob(jobId);
          if (onDelete) onDelete(jobId);
        }
      });

    // Old tech/contractor code removed - app is dispatcher + owner only
    if (false && (Auth.isTech() || Auth.isContractor())) {
      // Tech/contractor see jobs assigned to them
      // Use wildcard event to catch all changes, then filter client-side
      // This ensures we catch jobs being newly assigned (assigned_tech_id changes from null to user.id)
      channel
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'jobs'
        }, payload => {
          const newRow = payload.new;
          const oldRow = payload.old;
          const isAssignedToMe = newRow?.assigned_tech_id === user.id;
          const wasAssignedToMe = oldRow?.assigned_tech_id === user.id;

          if (payload.eventType === 'INSERT' && isAssignedToMe) {
            console.log('[Realtime] Tech INSERT: job', newRow.job_id, 'assigned to me');
            const job = _dbRowToJob(newRow, {}, false, true);
            Storage.saveJob(job);
            if (onInsert) onInsert(job);
          } else if (payload.eventType === 'UPDATE') {
            if (isAssignedToMe && !wasAssignedToMe) {
              // Job newly assigned to me
              console.log('[Realtime] Tech UPDATE: job', newRow.job_id, 'newly assigned to me');
              const job = _dbRowToJob(newRow, {}, false, true);
              Storage.saveJob(job);
              if (onInsert) onInsert(job); // Treat as new job for tech
            } else if (isAssignedToMe && wasAssignedToMe) {
              // Job still assigned to me, updated
              console.log('[Realtime] Tech UPDATE: job', newRow.job_id, 'updated');
              const job = _dbRowToJob(newRow, {}, false, true);
              Storage.saveJob(job);
              if (onUpdate) onUpdate(job);
            } else if (!isAssignedToMe && wasAssignedToMe) {
              // Job unassigned from me
              console.log('[Realtime] Tech UPDATE: job', oldRow.job_id, 'unassigned from me');
              Storage.deleteJob(oldRow.job_id);
              if (onDelete) onDelete(oldRow.job_id);
            }
          } else if (payload.eventType === 'DELETE' && wasAssignedToMe) {
            console.log('[Realtime] Tech DELETE: job', oldRow.job_id);
            Storage.deleteJob(oldRow.job_id);
            if (onDelete) onDelete(oldRow.job_id);
          }
        });

      // For contractors, also listen to jobs from their lead source
      if (Auth.isContractor() && user.assignedLeadSource) {
        channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: `source=eq.${user.assignedLeadSource}`
        }, payload => {
          if (payload.eventType === 'DELETE') {
            const jobId = payload.old?.job_id;
            if (jobId) {
              Storage.deleteJob(jobId);
              if (onDelete) onDelete(jobId);
            }
          } else {
            const job = _dbRowToJob(payload.new, {}, false, true);
            Storage.saveJob(job);
            if (payload.eventType === 'INSERT' && onInsert) onInsert(job);
            if (payload.eventType === 'UPDATE' && onUpdate) onUpdate(job);
          }
        });
      }
    }

    // Subscribe with status callback for reconnection handling
    return channel.subscribe((status, err) => {
      console.log('[Realtime] 📡 Jobs channel status:', status, err ? 'Error:' : '', err);
      if (window.DebugPanel && typeof DebugPanel.log === 'function') {
        try {
          DebugPanel.log('PUSH', `Realtime channel status: ${status}`, err ? { error: err } : null);
        } catch (e) { console.warn('[Debug] log failed:', e); }
      }
      if (status === 'SUBSCRIBED') {
        console.log('[Realtime] ✓ Successfully subscribed to jobs channel');
      } else if (status === 'CLOSED') {
        console.warn('[Realtime] ✗ Jobs channel closed - will retry');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[Realtime] ✗ Channel error:', err);
      } else if (status === 'TIMED_OUT') {
        console.error('[Realtime] ✗ Subscription timed out');
      }
      if (onStatusChange) onStatusChange(status);
    });
  }

  // ──────────────────────────────────────────────────────────
  // NOTIFICATIONS
  // ──────────────────────────────────────────────────────────

  async function getUnreadNotifications() {
    const { data } = await supa
      .from('notifications')
      .select('*')
      .or(`user_id.eq.${Auth.getUser()?.id},user_id.is.null`)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50);
    return data || [];
  }

  async function markNotificationRead(id) {
    await supa.from('notifications').update({ is_read: true }).eq('id', id);
  }

  async function markAllNotificationsRead() {
    const userId = Auth.getUser()?.id;
    if (!userId) return;
    await supa.from('notifications')
      .update({ is_read: true })
      .or(`user_id.eq.${userId},user_id.is.null`)
      .eq('is_read', false);
  }

  async function createNotification({ title, body, jobId }) {
    // Only admin and dispatcher can broadcast notifications (RLS enforces this too)
    if (!Auth.isAdminOrDisp()) {
      console.warn('DB.createNotification: caller is not admin/dispatcher — blocked');
      return;
    }
    // Broadcast to all (user_id = null)
    await supa.from('notifications').insert({
      user_id:    null,
      title,
      body,
      job_id:     jobId || null,
    });
  }

  function subscribeToNotifications(onNew) {
    return supa
      .channel('notifications-realtime')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: `user_id=eq.${Auth.getUser()?.id}`,
      }, payload => onNew(payload.new))
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: 'user_id=is.null',
      }, payload => onNew(payload.new))
      .subscribe();
  }

  // ──────────────────────────────────────────────────────────
  // REAL-TIME — subscribe to settings / profile changes
  // When admin changes app_settings or a profile, all clients
  // pick up the new data without requiring a page refresh.
  // ──────────────────────────────────────────────────────────

  function subscribeToSettings(onUpdate) {
    return supa
      .channel('settings-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings' }, async () => {
        await _syncSettingsDown();
        if (onUpdate) onUpdate();
      })
      .subscribe();
  }

  function subscribeToProfiles(onUpdate) {
    return supa
      .channel('profiles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async (payload) => {
        await _syncSettingsDown();
        if (onUpdate) onUpdate(payload);
      })
      .subscribe();
  }

  // ──────────────────────────────────────────────────────────
  // MAPPERS — DB row ↔ app job object
  // ──────────────────────────────────────────────────────────

  function _dbRowToJob(row, zelleMap, isAdmin = false, isTech = false) {
    const job = {
      jobId:               row.job_id,
      status:              row.status,
      customerName:        row.customer_name,
      phone:               row.phone,
      address:             row.address,
      city:                row.city,
      state:               row.state,
      zip:                 row.zip,
      scheduledDate:       row.scheduled_date || '',
      scheduledTime:       row.scheduled_time ? row.scheduled_time.slice(0,5) : '',
      description:         row.description,
      notes:               row.notes,
      source:              row.source,
      contractorName:      row.contractor_name,
      contractorPct:       row.contractor_pct || 0,
      assignedTechId:      row.assigned_tech_id,
      assignedTechName:    row.assigned_tech_name,
      isSelfAssigned:      row.is_self_assigned,
      techPercent:         row.tech_percent || 0,
      estimatedTotal:      row.estimated_total || 0,
      jobTotal:            row.job_total || 0,
      partsCost:           row.parts_cost || 0,
      taxAmount:           row.tax_amount || 0,
      taxOption:           row.tax_option || 'none',
      techPayout:          row.tech_payout || 0,
      paymentMethod:       row.payment_method,
      paidAt:              row.paid_at,
      syncStatus:          row.sync_status,
      syncedAt:            row.synced_at,
      photos:              row.photos || [],
      rawLead:             row.raw_lead,
      isRecurringCustomer: row.is_recurring_customer,
      overdueAt:           row.overdue_flagged_at,
      followUpAt:          row.follow_up_at,
      createdAt:           row.created_at,
      updatedAt:           row.updated_at,
    };

    // Only expose admin-only financial fields to admin users.
    // ownerPayout reveals business margin — never send to dispatcher, tech, or contractor.
    // contractorFee is the contractor's own cut — visible to contractors only.
    // techPayout is the tech's own cut — visible to techs only (DB view passes it through).
    if (isAdmin) {
      job.ownerPayout   = row.owner_payout   || 0;
      job.contractorFee = row.contractor_fee || 0;
      job.zelleMemo     = zelleMap?.[row.job_id] || '';
    } else {
      job.ownerPayout   = 0;
      // Contractors should see their own fee; the jobs_limited view passes it through
      job.contractorFee = Auth.isContractor() ? (row.contractor_fee || 0) : 0;
      job.zelleMemo     = '';
    }

    // Tech/contractor users must not see company revenue figures — zero them out.
    // Do NOT zero techPayout (tech's own cut) or contractorFee (contractor's own cut) —
    // those are already handled above and the DB view intentionally exposes them.
    if (isTech) {
      job.estimatedTotal = 0;
      job.jobTotal       = 0;
      job.partsCost      = 0;
      job.taxAmount      = 0;
    }

    return job;
  }

  function _jobToDbRow(job) {
    const row = {
      job_id:               job.jobId,
      status:               job.status,
      customer_name:        job.customerName || '',
      phone:                job.phone || '',
      address:              job.address || '',
      city:                 job.city || '',
      state:                job.state || '',
      zip:                  job.zip || '',
      scheduled_date:       job.scheduledDate || null,
      scheduled_time:       job.scheduledTime || null,
      description:          job.description || '',
      notes:                job.notes || '',
      source:               job.source || 'my_lead',
      contractor_name:      job.contractorName || '',
      contractor_pct:       parseFloat(job.contractorPct)  || 0,
      assigned_tech_id:     job.assignedTechId || null,
      assigned_tech_name:   job.assignedTechName || '',
      is_self_assigned:     job.isSelfAssigned || false,
      tech_percent:         parseFloat(job.techPercent)    || 0,
      estimated_total:      parseFloat(job.estimatedTotal) || 0,
      job_total:            parseFloat(job.jobTotal)       || 0,
      parts_cost:           parseFloat(job.partsCost)      || 0,
      tax_amount:           parseFloat(job.taxAmount)      || 0,
      tax_option:           job.taxOption || 'none',
      tech_payout:          parseFloat(job.techPayout)     || 0,
      payment_method:       job.paymentMethod || 'cash',
      paid_at:              job.paidAt || null,
      sync_status:          job.syncStatus || 'pending',
      synced_at:            job.syncedAt || null,
      photos:               job.photos || [],
      raw_lead:             job.rawLead || '',
      is_recurring_customer: job.isRecurringCustomer || false,
      overdue_flagged_at:   job.overdueAt || null,
      follow_up_at:         job.followUpAt || null,
      created_by:           job.createdBy || null,
      updated_at:           new Date().toISOString(),
    };

    // Only include admin-only financial columns when the current user is admin.
    // Non-admin clients must not write these — doing so would corrupt the DB
    // (they have zeroed-out copies of ownerPayout/contractorFee locally).
    if (Auth.isAdmin()) {
      row.owner_payout   = parseFloat(job.ownerPayout)   || 0;
      row.contractor_fee = parseFloat(job.contractorFee) || 0;
    }

    return row;
  }

  // Public sync functions for background polling
  async function syncJobsFromRemote() {
    await _syncJobsDown();
  }

  async function syncSettingsFromRemote() {
    await _syncSettingsDown();
  }

  return {
    init,
    // Jobs
    getJobs,
    saveJob,
    deleteJob,
    getJobById,
    getJobsByDate,
    getJobsByFilter,
    searchJobs,
    detectReturningCustomer,
    subscribeToJobs,
    syncJobsFromRemote,
    syncSettingsFromRemote,
    // Settings
    getSettings,
    saveSettings,
    updateSettingsCache,
    updateTechProfile,
    deleteProfile,
    getOwnerTech,
    getTechById,
    getSourceById,
    // Draft / sync / undo (localStorage only)
    saveDraft, getDraft, clearDraft,
    getSyncQueue, addToSyncQueue, removeFromSyncQueue, clearSyncQueue,
    saveUndo, getUndo, clearUndo,
    generateId,
    exportAll,
    // Notifications
    getUnreadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    createNotification,
    subscribeToNotifications,
    // Settings / profiles realtime
    subscribeToSettings,
    subscribeToProfiles,
    // Internal (for sync.js compatibility)
    _syncJobsDown,
  };

})();
