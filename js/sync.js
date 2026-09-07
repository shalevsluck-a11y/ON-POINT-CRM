/* ============================================================
   SYNC.JS — Google Sheets Sync Manager
   Sends jobs to Apps Script backend, handles retry, prevents duplicates
   ============================================================ */

const SyncManager = (() => {

  let _isSyncing = false;

  // ────────────────────────────────────────────
  // SYNC A SINGLE JOB
  // ────────────────────────────────────────────

  // The Apps Script answers JSON {ok:true,...}. When the deployment is gone Google serves an
  // HTML "Page Not Found" page with HTTP 200, which used to count as "synced".
  const DEAD_LINK_MSG = 'Google Sheets link is not working (Google returned a web page, not data). In the sheet: Extensions > Apps Script > Deploy > New deployment > Web app, Execute as Me, Anyone > paste the new URL in Settings.';
  async function _readScriptResponse(response) {
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!json || typeof json !== 'object') throw new Error(DEAD_LINK_MSG);
    if (json.ok === false) throw new Error(json.error || 'Apps Script returned an error');
    return json;
  }

  async function syncJob(job) {
    if (!job) {
      return { success: true, skipped: true };
    }

    const settings = Storage.getSettings();
    const url = settings.appsScriptUrl;

    if (!url || !url.includes('script.google.com')) {
      return { success: false, error: 'Apps Script URL not configured' };
    }

    const payload = _jobToSheetRow(job);

    try {
      // Use text/plain Content-Type — avoids CORS preflight and survives
      // the Apps Script redirect (script.google.com → googleusercontent.com).
      // Do NOT use no-cors: the POST body gets dropped on redirect with that mode.
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'upsertJob', data: payload }),
      });

      await _readScriptResponse(response);

      // Mark the CURRENT cached job, not the snapshot we were handed: the create flow syncs
      // a copy taken at save time, and writing that copy back a few seconds later erased
      // an Estimate / Mark Lost the user had made in between.
      const current = Storage.getJobById(job.jobId) || job;
      Storage.saveJob({ ...current, syncStatus: 'synced', syncedAt: new Date().toISOString() });
      Storage.removeFromSyncQueue(job.jobId);

      return { success: true };
    } catch (error) {
      console.warn(`Sync failed for job ${job.jobId}:`, error.message);
      Storage.saveJob({ ...(Storage.getJobById(job.jobId) || job), syncStatus: 'error' });
      return { success: false, error: error.message };
    }
  }

  // ────────────────────────────────────────────
  // SYNC ALL PENDING JOBS
  // ────────────────────────────────────────────

  async function syncAll(onProgress) {
    if (_isSyncing) return { success: false, error: 'Sync already in progress' };

    const settings = Storage.getSettings();
    if (!settings.appsScriptUrl) {
      return { success: false, error: 'Apps Script URL not configured. Go to Settings first.' };
    }

    _isSyncing = true;

    try {
      const queue = Storage.getSyncQueue();
      const allJobs = Storage.getJobs();

      // Also find any unsynced jobs not in queue
      const unsyncedJobs = allJobs.filter(j =>
        j.syncStatus !== 'synced' || queue.includes(j.jobId)
      );

      if (unsyncedJobs.length === 0) {
        // All synced — still do a full push to be safe
        // Push EVERY job (upsert by jobId): the sheet must be complete, not "the last 50".
        let count = 0, errs = 0, lastErr = '';
        for (const job of allJobs) {
          const r = await syncJob(job);
          if (r.success) count++; else { errs++; lastErr = r.error || ''; if (errs >= 3) break; }
          if (onProgress) onProgress(count + errs, allJobs.length);
          await _sleep(120);
        }
        Storage.saveSettings({ lastSyncAt: new Date().toISOString() });
        return { success: errs === 0, synced: count, errors: errs, error: lastErr, total: allJobs.length };
      }

      const results = [];
      let successCount = 0;
      let errorCount = 0;
      let lastError = '';

      for (let i = 0; i < unsyncedJobs.length; i++) {
        const job = unsyncedJobs[i];
        const r = await syncJob(job);
        results.push(r);
        if (r.success) successCount++;
        else { errorCount++; lastError = r.error || ''; if (errorCount >= 3 && successCount === 0) break; }
        if (onProgress) onProgress(i + 1, unsyncedJobs.length);

        // Small delay between requests to avoid rate limiting
        if (i < unsyncedJobs.length - 1) {
          await _sleep(150);
        }
      }

      Storage.saveSettings({ lastSyncAt: new Date().toISOString() });

      return {
        success: errorCount === 0,
        synced: successCount,
        errors: errorCount,
        error: lastError,
        total: unsyncedJobs.length,
      };
    } finally {
      _isSyncing = false;
    }
  }

  // ────────────────────────────────────────────
  // TEST CONNECTION
  // ────────────────────────────────────────────

  async function testConnection() {
    const settings = Storage.getSettings();
    const url = settings.appsScriptUrl;

    if (!url || !url.startsWith('https://')) {
      return { success: false, error: 'No Apps Script URL configured' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'ping' }),
      });
      await _readScriptResponse(response);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Could not reach Apps Script URL. Check the URL in Settings.' };
    }
  }

  // ────────────────────────────────────────────
  // JOB → SHEET ROW MAPPER
  // ────────────────────────────────────────────

  function _jobToSheetRow(job) {
    return {
      jobId:           job.jobId             || '',
      createdAt:       job.createdAt         || '',
      updatedAt:       job.updatedAt         || '',
      status:          job.status            || 'new',
      customerName:    job.customerName      || '',
      phone:           job.phone             || '',
      address:         job.address           || '',
      city:            job.city              || '',
      state:           job.state             || '',
      zip:             job.zip               || '',
      scheduledDate:   job.scheduledDate     || '',
      scheduledTime:   job.scheduledTime     || '',
      description:     job.description       || '',
      notes:           job.notes             || '',
      source:          job.source            || '',
      contractorName:  job.contractorName    || '',
      contractorPct:   job.contractorPct     || 0,
      assignedTechId:  job.assignedTechId    || '',
      assignedTechName:job.assignedTechName  || '',
      isSelfAssigned:  job.isSelfAssigned    ? 'YES' : 'NO',
      techPercent:     job.techPercent       || 0,
      estimatedTotal:  job.estimatedTotal    || 0,
      jobTotal:        job.jobTotal          || 0,
      partsCost:       job.partsCost         || 0,
      taxAmount:       job.taxAmount         || 0,
      techPayout:      job.techPayout        || 0,
      ownerPayout:     job.ownerPayout       || 0,
      contractorFee:   job.contractorFee     || 0,
      paymentMethod:   job.paymentMethod     || '',
      paidAt:          job.paidAt            || '',
      zelleMemo:       job.zelleMemo         || '',
      isRecurring:     job.isRecurringCustomer ? 'YES' : 'NO',
      photoCount:      (job.photos || []).length,
    };
  }

  // ────────────────────────────────────────────
  // QUEUE A JOB FOR SYNC
  // ────────────────────────────────────────────

  function queueJob(jobId) {
    Storage.addToSyncQueue(jobId);
  }

  // Remove a deleted job's row from the sheet (best effort; the sheet never learned about deletes before).
  async function deleteJob(jobId) {
    const url = Storage.getSettings().appsScriptUrl;
    if (!jobId || !url || !url.includes('script.google.com')) return { success: false, skipped: true };
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'deleteJob', data: { jobId } }) });
      await _readScriptResponse(response);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  }

  // ────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isSyncing() { return _isSyncing; }

  return {
    syncJob,
    syncAll,
    testConnection,
    queueJob,
    deleteJob,
    isSyncing,
  };

})();
