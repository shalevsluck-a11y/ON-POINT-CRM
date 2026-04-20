/* ============================================================
   REMINDERS.JS — Follow-up and overdue job detection
   Runs on init and every 30 minutes in the background.
   Flags overdue jobs, sends notifications to admin/dispatcher.
   ============================================================ */

const Reminders = (() => {

  let _interval = null;

  // ──────────────────────────────────────────────────────────
  // INIT — start background checker
  // ──────────────────────────────────────────────────────────

  function init() {
    // Run immediately on startup
    _check();
    // Then every 30 minutes
    _interval = setInterval(_check, 30 * 60 * 1000);
  }

  function destroy() {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // CHECK — scan for overdue jobs
  // ──────────────────────────────────────────────────────────

  async function _check() {
    if (!Auth.isAdminOrDisp()) return;

    const jobs   = DB.getJobs();
    const now    = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h ago

    let newlyOverdue = 0;

    for (const job of jobs) {
      if (['closed', 'paid', 'follow_up'].includes(job.status)) continue;
      if (!job.scheduledDate) continue;
      if (job.overdueAt) continue; // already flagged

      // Parse scheduled datetime
      const timeStr   = job.scheduledTime || '23:59';
      const [y, m, d] = job.scheduledDate.split('-').map(Number);
      const [hh, mm]  = timeStr.split(':').map(Number);
      const scheduled = new Date(y, m - 1, d, hh, mm);

      if (scheduled < cutoff) {
        // Flag as follow-up
        const updated = { ...job, status: 'follow_up', overdueAt: new Date().toISOString() };
        await DB.saveJob(updated);
        newlyOverdue++;

        // Notify
        await Notifications.send({
          title:  `⚠ Follow-up needed: ${job.customerName}`,
          body:   `${job.description || 'Job'} at ${job.address || 'unknown address'} — was scheduled ${_scheduledLabel(job.scheduledDate, job.scheduledTime)} and hasn't been closed.`,
          jobId:  job.jobId,
        });
      }
    }

    if (newlyOverdue > 0) {
      console.log(`Reminders: flagged ${newlyOverdue} overdue job(s)`);
      // Refresh the job list view if it's active
      if (typeof App !== 'undefined') {
        App.renderJobList();
        App.renderDashboard();
      }
    }
  }

  function _scheduledLabel(date, time) {
    if (!date) return 'unknown time';
    const [y, m, d] = date.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return time ? `${label} at ${_fmt12(time)}` : label;
  }

  function _fmt12(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${String(m).padStart(2,'0')} ${ap}`;
  }

  // Manual trigger (for admin)
  async function runNow() {
    await _check();
  }

  return { init, destroy, runNow };

})();
