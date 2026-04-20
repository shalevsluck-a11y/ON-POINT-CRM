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
      const { data, error } = await supa
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Also fetch zelle memos for admin
      let zelleMap = {};
      if (Auth.isAdmin()) {
        const { data: zm } = await supa.from('job_zelle').select('*');
        if (zm) zm.forEach(z => { zelleMap[z.job_id] = z.zelle_memo; });
      }

      const jobs = (data || []).map(row => _dbRowToJob(row, zelleMap));
      Storage.saveJobs(jobs);
    } catch (e) {
      console.warn('DB._syncJobsDown error (using cache):', e.message);
    }
  }

  async function _syncSettingsDown() {
    try {
      const { data: settings, error } = await supa
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .single();
      if (error) throw error;

      const { data: techs } = await supa
        .from('profiles')
        .select('id, name, phone, color, zip_codes, default_tech_percent, zelle_handle, is_owner, role')
        .order('name');

      const current = Storage.getSettings();
      Storage.saveSettings({
        ...current,
        ownerName:      settings.owner_name     || current.ownerName,
        ownerPhone:     settings.owner_phone    || current.ownerPhone,
        ownerZelle:     settings.owner_zelle    || current.ownerZelle,
        taxRateNY:      settings.tax_rate_ny    || current.taxRateNY,
        taxRateNJ:      settings.tax_rate_nj    || current.taxRateNJ,
        defaultState:   settings.default_state  || current.defaultState,
        appsScriptUrl:  settings.apps_script_url || current.appsScriptUrl,
        leadSources:    settings.lead_sources   || current.leadSources,
        technicians:    (techs || []).map(t => ({
          id:        t.id,
          name:      t.name,
          phone:     t.phone,
          color:     t.color || '#3B82F6',
          zipCodes:  t.zip_codes || [],
          percent:   t.default_tech_percent || 60,
          zelle:     t.zelle_handle || '',
          isOwner:   t.is_owner || false,
          role:      t.role,
        })),
      });
    } catch (e) {
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
    // Write to cache immediately
    Storage.saveJob(job);
    // Push to Supabase in background
    _upsertJobRemote(job).catch(e => console.warn('DB.saveJob remote error:', e.message));
    return job;
  }

  async function _upsertJobRemote(job) {
    const row = _jobToDbRow(job);
    const { error } = await supa.from('jobs').upsert(row);
    if (error) throw error;

    // Handle zelle memo (admin-only table)
    if (Auth.isAdmin() && job.zelleMemo !== undefined) {
      await supa.from('job_zelle').upsert({
        job_id:     job.jobId,
        zelle_memo: job.zelleMemo || '',
      });
    }
  }

  async function deleteJob(jobId) {
    Storage.deleteJob(jobId);
    const { error } = await supa.from('jobs').delete().eq('job_id', jobId);
    if (error) console.warn('DB.deleteJob remote error:', error.message);
  }

  // ──────────────────────────────────────────────────────────
  // SETTINGS — read/write
  // ──────────────────────────────────────────────────────────

  function getSettings() { return Storage.getSettings(); }

  async function saveSettings(updates) {
    Storage.saveSettings(updates);
    if (Auth.isAdmin()) {
      await supa.from('app_settings').update({
        owner_name:      updates.ownerName,
        owner_phone:     updates.ownerPhone,
        owner_zelle:     updates.ownerZelle,
        tax_rate_ny:     updates.taxRateNY,
        tax_rate_nj:     updates.taxRateNJ,
        default_state:   updates.defaultState,
        apps_script_url: updates.appsScriptUrl,
        lead_sources:    updates.leadSources,
      }).eq('id', 1).catch(e => console.warn('DB.saveSettings error:', e.message));
    }
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
  // REAL-TIME — subscribe to live job changes
  // ──────────────────────────────────────────────────────────

  function subscribeToJobs(onInsert, onUpdate) {
    return supa
      .channel('jobs-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, payload => {
        const job = _dbRowToJob(payload.new, {});
        Storage.saveJob(job);
        if (onInsert) onInsert(job);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, payload => {
        const job = _dbRowToJob(payload.new, {});
        Storage.saveJob(job);
        if (onUpdate) onUpdate(job);
      })
      .subscribe();
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
  // MAPPERS — DB row ↔ app job object
  // ──────────────────────────────────────────────────────────

  function _dbRowToJob(row, zelleMap) {
    return {
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
      ownerPayout:         row.owner_payout || 0,
      contractorFee:       row.contractor_fee || 0,
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
      zelleMemo:           zelleMap?.[row.job_id] || '',
    };
  }

  function _jobToDbRow(job) {
    return {
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
      owner_payout:         parseFloat(job.ownerPayout)    || 0,
      contractor_fee:       parseFloat(job.contractorFee)  || 0,
      payment_method:       job.paymentMethod || 'cash',
      paid_at:              job.paidAt || null,
      sync_status:          job.syncStatus || 'pending',
      synced_at:            job.syncedAt || null,
      photos:               job.photos || [],
      raw_lead:             job.rawLead || '',
      is_recurring_customer: job.isRecurringCustomer || false,
      overdue_flagged_at:   job.overdueAt || null,
      follow_up_at:         job.followUpAt || null,
      updated_at:           new Date().toISOString(),
    };
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
    // Settings
    getSettings,
    saveSettings,
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
    // Internal (for sync.js compatibility)
    _syncJobsDown,
  };

})();
