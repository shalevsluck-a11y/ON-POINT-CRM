/* ============================================================
   STORAGE.JS — localStorage layer
   All reads/writes for jobs, settings, drafts, sync queue
   ============================================================ */

const Storage = (() => {

  const KEYS = {
    JOBS:       'op_jobs',
    SETTINGS:   'op_settings',
    DRAFT:      'op_draft',
    SYNC_QUEUE: 'op_sync_queue',
    UNDO:       'op_undo',
  };

  // ────────────────────────────────────────────
  // JOBS
  // ────────────────────────────────────────────

  function getJobs() {
    try {
      const raw = localStorage.getItem(KEYS.JOBS);
      if (!raw) return [];
      const jobs = JSON.parse(raw);
      return Array.isArray(jobs) ? jobs : [];
    } catch (e) {
      console.error('Storage.getJobs error:', e);
      return [];
    }
  }

  function saveJobs(jobs) {
    try {
      localStorage.setItem(KEYS.JOBS, JSON.stringify(jobs));
      return true;
    } catch (e) {
      // Quota exceeded — try to remove old photo data
      if (e.name === 'QuotaExceededError') {
        console.warn('Storage full — attempting photo cleanup');
        _trimPhotoStorage(jobs);
        try {
          localStorage.setItem(KEYS.JOBS, JSON.stringify(jobs));
          return true;
        } catch (e2) {
          console.error('Storage full even after cleanup:', e2);
          return false;
        }
      }
      return false;
    }
  }

  function _trimPhotoStorage(jobs) {
    // Trim oldest photos from old paid jobs to free space
    const trimmed = jobs.map(j => {
      if (j.status === 'paid' && j.photos && j.photos.length > 0) {
        return { ...j, photos: [] };
      }
      return j;
    });
    return trimmed;
  }

  function getJobById(jobId) {
    return getJobs().find(j => j.jobId === jobId) || null;
  }

  function saveJob(job) {
    // Upsert — insert or update by jobId
    const jobs = getJobs();
    const idx = jobs.findIndex(j => j.jobId === job.jobId);
    if (idx >= 0) {
      jobs[idx] = { ...jobs[idx], ...job, updatedAt: new Date().toISOString() };
    } else {
      jobs.unshift({ ...job, createdAt: job.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    return saveJobs(jobs) ? job : null;
  }

  function deleteJob(jobId) {
    const jobs = getJobs().filter(j => j.jobId !== jobId);
    return saveJobs(jobs);
  }

  function getJobsByDate(dateStr) {
    // dateStr = 'YYYY-MM-DD'
    return getJobs().filter(j => j.scheduledDate === dateStr);
  }

  function searchJobs(query) {
    if (!query || !query.trim()) return getJobs();
    const q = query.toLowerCase().trim();
    return getJobs().filter(j => {
      const searchIn = [
        j.customerName,
        j.phone,
        j.address,
        j.city,
        j.zip,
        j.description,
        j.notes,
        j.assignedTechName,
        j.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return searchIn.includes(q);
    });
  }

  function getJobsByFilter(filter) {
    const jobs = getJobs();
    const today = _todayStr();
    const weekAgo = _daysAgoStr(7);
    const monthAgo = _daysAgoStr(30);

    switch (filter) {
      case 'today':
        return jobs.filter(j => j.scheduledDate === today || j.createdAt?.startsWith(today));
      case 'week':
        return jobs.filter(j => j.scheduledDate >= weekAgo || j.createdAt >= weekAgo + 'T');
      case 'month':
        return jobs.filter(j => j.scheduledDate >= monthAgo || j.createdAt >= monthAgo + 'T');
      case 'new':
      case 'scheduled':
      case 'in_progress':
      case 'closed':
      case 'paid':
        return jobs.filter(j => j.status === filter);
      default:
        return jobs;
    }
  }

  function _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function _daysAgoStr(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function detectReturningCustomer(phone) {
    if (!phone) return null;
    const normalized = phone.replace(/\D/g, '');
    if (normalized.length < 10) return null;
    const jobs = getJobs();
    const matches = jobs.filter(j => j.phone && j.phone.replace(/\D/g,'') === normalized);
    if (matches.length === 0) return null;
    return {
      isReturning: true,
      jobCount: matches.length,
      lastJob: matches[0], // jobs are newest-first
    };
  }

  // ────────────────────────────────────────────
  // SETTINGS
  // ────────────────────────────────────────────

  const DEFAULT_SETTINGS = {
    ownerName:      '',
    ownerPhone:     '',
    ownerZelle:     '',
    taxRateNY:      8.875,
    taxRateNJ:      6.625,
    defaultState:   'NY',
    appsScriptUrl:  '',
    technicians:    [],
    leadSources:    [],
    lastSyncAt:     null,
  };

  function getSettings() {
    try {
      const raw = localStorage.getItem(KEYS.SETTINGS);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) {
      console.error('Storage.getSettings error:', e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    try {
      const current = getSettings();
      const merged = { ...current, ...settings };
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify(merged));
      return true;
    } catch (e) {
      console.error('Storage.saveSettings error:', e);
      return false;
    }
  }

  function getOwnerTech() {
    const settings = getSettings();
    return settings.technicians.find(t => t.isOwner) || null;
  }

  function getTechById(id) {
    return getSettings().technicians.find(t => t.id === id) || null;
  }

  function getSourceById(id) {
    return getSettings().leadSources.find(s => s.id === id) || null;
  }

  // ────────────────────────────────────────────
  // DRAFT (auto-save new job in progress)
  // ────────────────────────────────────────────

  function saveDraft(data) {
    try {
      localStorage.setItem(KEYS.DRAFT, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
    } catch (e) { /* ignore */ }
  }

  function getDraft() {
    try {
      const raw = localStorage.getItem(KEYS.DRAFT);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      // Expire drafts older than 7 days
      if (draft.savedAt) {
        const age = Date.now() - new Date(draft.savedAt).getTime();
        if (age > 7 * 24 * 60 * 60 * 1000) { clearDraft(); return null; }
      }
      return draft;
    } catch (e) { return null; }
  }

  function clearDraft() {
    localStorage.removeItem(KEYS.DRAFT);
  }

  // ────────────────────────────────────────────
  // SYNC QUEUE
  // ────────────────────────────────────────────

  function getSyncQueue() {
    try {
      const raw = localStorage.getItem(KEYS.SYNC_QUEUE);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function addToSyncQueue(jobId) {
    const q = getSyncQueue();
    if (!q.includes(jobId)) q.push(jobId);
    try { localStorage.setItem(KEYS.SYNC_QUEUE, JSON.stringify(q)); } catch (e) {}
  }

  function removeFromSyncQueue(jobId) {
    const q = getSyncQueue().filter(id => id !== jobId);
    try { localStorage.setItem(KEYS.SYNC_QUEUE, JSON.stringify(q)); } catch (e) {}
  }

  function clearSyncQueue() {
    localStorage.removeItem(KEYS.SYNC_QUEUE);
  }

  // ────────────────────────────────────────────
  // UNDO (last deleted / changed job)
  // ────────────────────────────────────────────

  function saveUndo(snapshot) {
    try {
      localStorage.setItem(KEYS.UNDO, JSON.stringify({ snapshot, at: Date.now() }));
    } catch (e) {}
  }

  function getUndo() {
    try {
      const raw = localStorage.getItem(KEYS.UNDO);
      if (!raw) return null;
      const u = JSON.parse(raw);
      // Only allow undo within 30 seconds
      if (Date.now() - u.at > 30000) { clearUndo(); return null; }
      return u.snapshot;
    } catch (e) { return null; }
  }

  function clearUndo() {
    localStorage.removeItem(KEYS.UNDO);
  }

  // ────────────────────────────────────────────
  // DATA EXPORT / IMPORT
  // ────────────────────────────────────────────

  function exportAll() {
    return {
      jobs:     getJobs(),
      settings: getSettings(),
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };
  }

  function importAll(data) {
    if (!data || !data.jobs || !Array.isArray(data.jobs)) {
      throw new Error('Invalid export file format');
    }
    if (data.settings) saveSettings(data.settings);
    saveJobs(data.jobs);
    return data.jobs.length;
  }

  function clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  }

  // ────────────────────────────────────────────
  // UTILITY
  // ────────────────────────────────────────────

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  return {
    // Jobs
    getJobs,
    saveJob,
    deleteJob,
    getJobById,
    getJobsByDate,
    searchJobs,
    getJobsByFilter,
    detectReturningCustomer,
    // Settings
    getSettings,
    saveSettings,
    getOwnerTech,
    getTechById,
    getSourceById,
    // Draft
    saveDraft,
    getDraft,
    clearDraft,
    // Sync
    getSyncQueue,
    addToSyncQueue,
    removeFromSyncQueue,
    clearSyncQueue,
    // Undo
    saveUndo,
    getUndo,
    clearUndo,
    // Data
    exportAll,
    importAll,
    clearAll,
    generateId,
  };

})();
