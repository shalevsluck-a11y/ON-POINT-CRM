/* ============================================================
   CLEANUP.JS — Clear stuck jobs from localStorage
   ============================================================ */

const Cleanup = (() => {

  async function clearStuckJobs() {
    if (!confirm('This will remove all jobs from your device that don\'t exist in the database. Continue?')) {
      return;
    }

    try {
      // Get all jobs from database
      const { data: dbJobs, error } = await SupabaseClient
        .from('jobs')
        .select('job_id');

      if (error) throw error;

      const dbJobIds = new Set((dbJobs || []).map(j => j.job_id));

      // Get local jobs
      const localJobs = Storage.getJobs();

      // Find stuck jobs (in local but not in database)
      const stuckJobs = localJobs.filter(j => !dbJobIds.has(j.jobId));

      if (stuckJobs.length === 0) {
        App.showToast('No stuck jobs found - everything is in sync!', 'success');
        return;
      }

      // Remove stuck jobs
      const cleanedJobs = localJobs.filter(j => dbJobIds.has(j.jobId));
      Storage.saveJobs(cleanedJobs);

      App.showToast(`Cleared ${stuckJobs.length} stuck job(s)`, 'success');

      // Refresh the view
      if (typeof App.renderDashboard === 'function') App.renderDashboard();
      if (typeof App.renderJobList === 'function') App.renderJobList();

    } catch (e) {
      App.showToast('Failed to clear stuck jobs: ' + e.message, 'error');
    }
  }

  return {
    clearStuckJobs
  };

})();
