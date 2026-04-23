/**
 * PUSH NOTIFICATION DEBUG PANEL
 * Visible on-screen debugging for iOS PWA push notification flow
 */

const DebugPanel = (() => {
  let panel = null;
  let logsContainer = null;
  let logs = [];
  const MAX_LOGS = 200;
  const STORAGE_KEY = 'push-debug-logs';

  // Load persisted logs
  function loadLogs() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        logs = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load debug logs:', e);
    }
  }

  // Save logs to localStorage
  function saveLogs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOGS)));
    } catch (e) {
      console.error('Failed to save debug logs:', e);
    }
  }

  // Create panel UI
  function createPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'push-debug-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 250px;
      background: #0f172a;
      border-top: 2px solid #3b82f6;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      font-family: monospace;
      font-size: 10px;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 8px;
      background: #1e293b;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #334155;
    `;
    header.innerHTML = `
      <span>🐛 PUSH DEBUG (${logs.length} logs)</span>
      <div>
        <button id="debug-clear" style="padding:4px 8px;margin-right:4px;font-size:10px;">Clear</button>
        <button id="debug-test" style="padding:4px 8px;margin-right:4px;font-size:10px;background:#059669;color:white;border:none;">Test Push</button>
        <button id="debug-toggle" style="padding:4px 8px;font-size:10px;">Hide</button>
      </div>
    `;

    // Logs container
    logsContainer = document.createElement('div');
    logsContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      color: #94a3b8;
      background: #0f172a;
    `;

    panel.appendChild(header);
    panel.appendChild(logsContainer);
    document.body.appendChild(panel);

    // Event listeners
    document.getElementById('debug-clear').onclick = clearLogs;
    document.getElementById('debug-toggle').onclick = togglePanel;
    document.getElementById('debug-test').onclick = sendTestPush;

    // Render existing logs
    renderLogs();
  }

  // Add log entry
  function log(category, message, data = null, isError = false) {
    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
    const entry = {
      time: timestamp,
      category,
      message,
      data,
      isError,
    };

    logs.push(entry);
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }

    saveLogs();
    renderLogs();

    // Also console.log
    const prefix = `[${category}]`;
    if (isError) {
      console.error(prefix, message, data || '');
    } else {
      console.log(prefix, message, data || '');
    }
  }

  // Render all logs
  function renderLogs() {
    if (!logsContainer) return;

    logsContainer.innerHTML = logs
      .map(entry => {
        const color = entry.isError ? '#ef4444' :
                     entry.category === 'SW' ? '#3b82f6' :
                     entry.category === 'BACKEND' ? '#8b5cf6' :
                     entry.category === 'SUBSCRIPTION' ? '#10b981' :
                     entry.category === 'PUSH' ? '#f59e0b' : '#94a3b8';

        const dataStr = entry.data ? `\n  ${JSON.stringify(entry.data)}` : '';

        return `<div style="margin-bottom:4px;color:${color}">
          [${entry.time}] ${entry.category}: ${entry.message}${dataStr}
        </div>`;
      })
      .join('');

    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  // Clear logs
  function clearLogs() {
    logs = [];
    saveLogs();
    renderLogs();
    log('SYSTEM', 'Logs cleared');
  }

  // Toggle panel visibility
  function togglePanel() {
    if (panel.style.height === '0px' || panel.style.height === '0') {
      panel.style.height = '250px';
      document.getElementById('debug-toggle').textContent = 'Hide';
    } else {
      panel.style.height = '0px';
      document.getElementById('debug-toggle').textContent = 'Show';
    }
  }

  // Send test push
  async function sendTestPush() {
    log('TEST', 'Sending test push notification...');

    try {
      const user = Auth?.getUser();
      if (!user) {
        log('TEST', 'No user logged in', null, true);
        return;
      }

      const response = await fetch('/api/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id })
      });

      const result = await response.json();

      if (response.ok) {
        log('TEST', 'Test push sent successfully', result);
      } else {
        log('TEST', 'Test push failed', result, true);
      }
    } catch (error) {
      log('TEST', 'Test push error', error.message, true);
    }
  }

  // Listen for service worker messages
  function setupServiceWorkerListener() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'PUSH_RECEIVED') {
          log('PUSH', `✅ Push received at ${event.data.timestamp}`);
          log('PUSH', `Title: "${event.data.data.title}"`);
          log('PUSH', `Body: "${event.data.data.body}"`);
          if (event.data.data.jobId) {
            log('PUSH', `Job ID: ${event.data.data.jobId}`);
          }
          if (event.data.parseError) {
            log('PUSH', `Parse error: ${event.data.parseError}`, null, true);
          }
          if (event.data.execLog) {
            log('PUSH', 'Execution log:', event.data.execLog);
          }
        } else if (event.data.type === 'PUSH_ERROR') {
          log('PUSH', `❌ Push handler error: ${event.data.error}`, event.data.execLog, true);
        }
      });
    }
  }

  // Initialize
  function init() {
    loadLogs();
    createPanel();
    setupServiceWorkerListener();
    log('SYSTEM', 'Debug panel initialized');
  }

  return {
    init,
    log,
    clearLogs,
  };
})();

// Auto-initialize when loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => DebugPanel.init());
} else {
  DebugPanel.init();
}

// Expose globally
window.DebugPanel = DebugPanel;
