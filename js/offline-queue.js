/* ============================================================
   OFFLINE QUEUE - Never lose data, sync when back online
   Uses IndexedDB to store pending operations
   ============================================================ */

const OfflineQueue = (() => {

  const DB_NAME = 'onpoint-offline-queue';
  const DB_VERSION = 1;
  const STORE_NAME = 'pending_operations';

  let _db = null;
  let _syncInProgress = false;
  let _pendingCount = 0;

  // ──────────────────────────────────────────────────────────
  // INITIALIZATION
  // ──────────────────────────────────────────────────────────

  async function init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        _db = request.result;
        console.log('[OfflineQueue] Database opened');
        _updatePendingCount();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          console.log('[OfflineQueue] Object store created');
        }
      };
    });
  }

  // ──────────────────────────────────────────────────────────
  // QUEUE OPERATIONS
  // ──────────────────────────────────────────────────────────

  async function enqueue(operation) {
    if (!_db) await init();

    return new Promise((resolve, reject) => {
      const transaction = _db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const item = {
        ...operation,
        timestamp: Date.now(),
        attempts: 0,
        lastError: null
      };

      const request = store.add(item);

      request.onsuccess = () => {
        console.log('[OfflineQueue] Operation queued:', operation.type, operation.table);
        _pendingCount++;
        _updatePendingUI();
        resolve(request.result);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async function dequeue(id) {
    if (!_db) return;

    return new Promise((resolve, reject) => {
      const transaction = _db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        _pendingCount = Math.max(0, _pendingCount - 1);
        _updatePendingUI();
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async function getAll() {
    if (!_db) await init();

    return new Promise((resolve, reject) => {
      const transaction = _db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function clear() {
    if (!_db) return;

    return new Promise((resolve, reject) => {
      const transaction = _db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        _pendingCount = 0;
        _updatePendingUI();
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ──────────────────────────────────────────────────────────
  // SYNC - Process queued operations
  // ──────────────────────────────────────────────────────────

  async function sync() {
    if (_syncInProgress) {
      console.log('[OfflineQueue] Sync already in progress');
      return;
    }

    _syncInProgress = true;
    console.log('[OfflineQueue] Starting sync...');

    try {
      const operations = await getAll();
      console.log(`[OfflineQueue] Found ${operations.length} pending operations`);

      for (const op of operations) {
        try {
          await _executeOperation(op);
          await dequeue(op.id);
          console.log('[OfflineQueue] ✓ Synced:', op.type, op.table);
        } catch (error) {
          console.error('[OfflineQueue] ✗ Failed to sync:', op.type, error.message);

          // Update error count
          op.attempts++;
          op.lastError = error.message;

          // If failed too many times, remove it
          if (op.attempts >= 5) {
            console.error('[OfflineQueue] Operation failed 5 times, removing:', op);
            await dequeue(op.id);
          }
        }
      }

      console.log('[OfflineQueue] Sync complete');
      await _updatePendingCount();

    } catch (error) {
      console.error('[OfflineQueue] Sync error:', error);
    } finally {
      _syncInProgress = false;
    }
  }

  async function _executeOperation(op) {
    const { type, table, data, id: recordId } = op;

    switch (type) {
      case 'insert':
        const { error: insertError } = await SupabaseClient
          .from(table)
          .insert(data);
        if (insertError) throw insertError;
        break;

      case 'update':
        const { error: updateError } = await SupabaseClient
          .from(table)
          .update(data)
          .eq('id', recordId);
        if (updateError) throw updateError;
        break;

      case 'delete':
        const { error: deleteError } = await SupabaseClient
          .from(table)
          .delete()
          .eq('id', recordId);
        if (deleteError) throw deleteError;
        break;

      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // AUTO-SYNC when back online
  // ──────────────────────────────────────────────────────────

  window.addEventListener('online', () => {
    console.log('[OfflineQueue] Browser back online, syncing...');
    setTimeout(() => sync(), 1000);
  });

  // Subscribe to realtime status changes
  if (window.RealtimeManager) {
    RealtimeManager.onStatusChange((status) => {
      if (status.connected && _pendingCount > 0) {
        console.log('[OfflineQueue] Connection restored, syncing...');
        sync();
      }
    });
  }

  // ──────────────────────────────────────────────────────────
  // UI UPDATES
  // ──────────────────────────────────────────────────────────

  async function _updatePendingCount() {
    const operations = await getAll();
    _pendingCount = operations.length;
    _updatePendingUI();
  }

  function _updatePendingUI() {
    const indicator = document.getElementById('offline-queue-status');
    if (!indicator) return;

    if (_pendingCount > 0) {
      indicator.innerHTML = `
        <button onclick="OfflineQueue.sync()"
          style="background: #F59E0B; color: white; border: none; padding: 4px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <span>⏳</span>
          <span>${_pendingCount} pending</span>
        </button>
      `;
      indicator.style.display = 'block';
    } else {
      indicator.style.display = 'none';
    }
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────

  return {
    init,
    enqueue,
    sync,
    clear,
    getPendingCount: () => _pendingCount
  };

})();

// Auto-initialize
if (typeof window !== 'undefined') {
  window.OfflineQueue = OfflineQueue;
  OfflineQueue.init();
}
