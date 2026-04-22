/* ============================================================
   OPTIMISTIC UI - Instant feedback like WhatsApp
   Updates UI immediately, rolls back if server fails
   ============================================================ */

const OptimisticUI = (() => {

  let _pendingOperations = new Map();
  let _rollbackHandlers = new Map();

  // ──────────────────────────────────────────────────────────
  // CORE - Execute operation optimistically
  // ──────────────────────────────────────────────────────────

  async function execute(operation) {
    const opId = _generateOpId();

    console.log(`[OptimisticUI] ${operation.type} ${operation.table}`, operation.data);

    // 1. Apply optimistic update to UI immediately
    const rollback = await _applyOptimistic(operation);
    _rollbackHandlers.set(opId, rollback);
    _pendingOperations.set(opId, operation);

    // 2. Show visual feedback
    _showOperationFeedback(operation, 'pending');

    try {
      // 3. Execute actual operation
      const result = await _executeOperation(operation);

      // 4. Operation succeeded!
      _pendingOperations.delete(opId);
      _rollbackHandlers.delete(opId);
      _showOperationFeedback(operation, 'success');

      console.log(`[OptimisticUI] ✓ ${operation.type} confirmed`);
      return result;

    } catch (error) {
      console.error(`[OptimisticUI] ✗ ${operation.type} failed:`, error);

      // 5. Operation failed - rollback UI
      if (rollback) {
        await rollback();
      }

      _pendingOperations.delete(opId);
      _rollbackHandlers.delete(opId);
      _showOperationFeedback(operation, 'error', error.message);

      // 6. Queue for offline sync if network error
      if (error.message.includes('network') || error.message.includes('offline')) {
        await OfflineQueue.enqueue(operation);
        _showOperationFeedback(operation, 'queued');
      }

      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────
  // APPLY OPTIMISTIC UPDATES
  // ──────────────────────────────────────────────────────────

  async function _applyOptimistic(operation) {
    const { type, table, data, id } = operation;

    switch (table) {
      case 'jobs':
        return _applyJobUpdate(type, data, id);
      case 'notifications':
        return _applyNotificationUpdate(type, data, id);
      default:
        console.warn(`[OptimisticUI] No optimistic handler for table: ${table}`);
        return null;
    }
  }

  function _applyJobUpdate(type, data, id) {
    const jobs = Storage.getJobs();
    let previousState = null;

    switch (type) {
      case 'insert':
        // Add job to UI immediately
        const newJob = { ...data, id: id || Storage.generateId() };
        previousState = [...jobs];
        Storage.saveJobs([...jobs, newJob]);

        // Update UI
        if (window.App && window.App.renderJobList) {
          window.App.renderJobList();
        }

        return () => {
          // Rollback: remove the job
          Storage.saveJobs(previousState);
          if (window.App && window.App.renderJobList) {
            window.App.renderJobList();
          }
        };

      case 'update':
        // Update job in UI immediately
        previousState = jobs.find(j => j.id === id);
        if (!previousState) return null;

        const updatedJobs = jobs.map(j => j.id === id ? { ...j, ...data } : j);
        Storage.saveJobs(updatedJobs);

        // Update UI
        if (window.App && window.App.renderJobList) {
          window.App.renderJobList();
        }

        return () => {
          // Rollback: restore previous state
          const rolledBackJobs = jobs.map(j => j.id === id ? previousState : j);
          Storage.saveJobs(rolledBackJobs);
          if (window.App && window.App.renderJobList) {
            window.App.renderJobList();
          }
        };

      case 'delete':
        // Remove job from UI immediately
        previousState = jobs.find(j => j.id === id);
        if (!previousState) return null;

        const filteredJobs = jobs.filter(j => j.id !== id);
        Storage.saveJobs(filteredJobs);

        // Update UI
        if (window.App && window.App.renderJobList) {
          window.App.renderJobList();
        }

        return () => {
          // Rollback: restore the job
          Storage.saveJobs([...jobs]);
          if (window.App && window.App.renderJobList) {
            window.App.renderJobList();
          }
        };

      default:
        return null;
    }
  }

  function _applyNotificationUpdate(type, data, id) {
    // Similar optimistic updates for notifications
    // Implement based on notification structure
    return null;
  }

  // ──────────────────────────────────────────────────────────
  // EXECUTE ACTUAL OPERATION
  // ──────────────────────────────────────────────────────────

  async function _executeOperation(operation) {
    const { type, table, data, id } = operation;

    switch (type) {
      case 'insert':
        const { data: insertedData, error: insertError } = await SupabaseClient
          .from(table)
          .insert(data)
          .select()
          .single();

        if (insertError) throw insertError;
        return insertedData;

      case 'update':
        const { data: updatedData, error: updateError } = await SupabaseClient
          .from(table)
          .update(data)
          .eq('id', id)
          .select()
          .single();

        if (updateError) throw updateError;
        return updatedData;

      case 'delete':
        const { error: deleteError } = await SupabaseClient
          .from(table)
          .delete()
          .eq('id', id);

        if (deleteError) throw deleteError;
        return { success: true };

      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // VISUAL FEEDBACK
  // ──────────────────────────────────────────────────────────

  function _showOperationFeedback(operation, status, errorMsg = null) {
    const messages = {
      pending: {
        insert: '⏳ Adding...',
        update: '⏳ Updating...',
        delete: '⏳ Deleting...'
      },
      success: {
        insert: '✓ Added!',
        update: '✓ Updated!',
        delete: '✓ Deleted!'
      },
      error: {
        insert: '✗ Add failed',
        update: '✗ Update failed',
        delete: '✗ Delete failed'
      },
      queued: {
        insert: '⏰ Queued for sync',
        update: '⏰ Queued for sync',
        delete: '⏰ Queued for sync'
      }
    };

    const message = messages[status]?.[operation.type] || `${status} ${operation.type}`;

    if (status === 'error' && errorMsg) {
      console.error(message, errorMsg);
      if (window.App && window.App.showToast) {
        window.App.showToast(errorMsg, 'error');
      }
    } else if (status === 'success') {
      // Don't show toast for success - too noisy
      // Just log it
      console.log(message);
    } else if (status === 'queued') {
      if (window.App && window.App.showToast) {
        window.App.showToast('Saved locally, will sync when online', 'info');
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────

  function _generateOpId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────

  // Convenience methods for common operations
  async function insertJob(jobData) {
    return execute({
      type: 'insert',
      table: 'jobs',
      data: jobData
    });
  }

  async function updateJob(jobId, updates) {
    return execute({
      type: 'update',
      table: 'jobs',
      data: updates,
      id: jobId
    });
  }

  async function deleteJob(jobId) {
    return execute({
      type: 'delete',
      table: 'jobs',
      id: jobId
    });
  }

  function getPendingOperations() {
    return Array.from(_pendingOperations.values());
  }

  return {
    execute,
    insertJob,
    updateJob,
    deleteJob,
    getPendingOperations
  };

})();

// Make it global
if (typeof window !== 'undefined') {
  window.OptimisticUI = OptimisticUI;
}
