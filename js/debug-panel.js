// Debug Panel - Shows realtime connection status and logs
const DebugPanel = (() => {
  let _logs = [];
  let _panelVisible = false;

  function init() {
    // Create debug panel HTML
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      max-height: 300px;
      background: rgba(0, 0, 0, 0.95);
      color: #0f0;
      font-family: monospace;
      font-size: 11px;
      padding: 10px;
      overflow-y: auto;
      z-index: 99999;
      border-top: 2px solid #0f0;
      display: none;
    `;

    document.body.appendChild(panel);

    // Create toggle button
    const toggle = document.createElement('button');
    toggle.id = 'debug-toggle';
    toggle.textContent = '🐛 DEBUG';
    toggle.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: rgba(0, 255, 0, 0.9);
      color: #000;
      border: 2px solid #0f0;
      padding: 8px 16px;
      font-weight: bold;
      font-size: 12px;
      cursor: pointer;
      z-index: 100000;
      border-radius: 4px;
    `;
    toggle.onclick = togglePanel;
    document.body.appendChild(toggle);

    // Intercept console.log, console.error, console.warn
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = function(...args) {
      originalLog.apply(console, args);
      addLog('LOG', args.join(' '));
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      addLog('ERROR', args.join(' '));
    };

    console.warn = function(...args) {
      originalWarn.apply(console, args);
      addLog('WARN', args.join(' '));
    };

    // Show status immediately
    addLog('INFO', '🐛 Debug panel initialized');
    addLog('INFO', `User: ${Auth.getUser()?.name || 'Not logged in'}`);
    addLog('INFO', `Role: ${Auth.getUser()?.role || 'Unknown'}`);
  }

  function addLog(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const color = {
      'LOG': '#0f0',
      'ERROR': '#f00',
      'WARN': '#ff0',
      'INFO': '#0ff',
      'REALTIME': '#f0f'
    }[type] || '#0f0';

    const logEntry = {
      timestamp,
      type,
      message,
      color
    };

    _logs.push(logEntry);

    // Keep only last 100 logs
    if (_logs.length > 100) {
      _logs.shift();
    }

    updatePanel();
  }

  function updatePanel() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return;

    // Show last 50 logs
    const recentLogs = _logs.slice(-50);

    panel.innerHTML = `
      <div style="margin-bottom: 10px; border-bottom: 1px solid #0f0; padding-bottom: 5px;">
        <strong>🐛 DEBUG PANEL - Last ${recentLogs.length} events</strong>
        <button onclick="DebugPanel.clearLogs()" style="float: right; background: #f00; color: #fff; border: none; padding: 2px 8px; cursor: pointer;">Clear</button>
      </div>
      <div>
        ${recentLogs.map(log => `
          <div style="color: ${log.color}; margin: 2px 0;">
            <span style="color: #888;">[${log.timestamp}]</span>
            <span style="color: #ff0;">[${log.type}]</span>
            ${log.message}
          </div>
        `).join('')}
      </div>
    `;

    // Auto-scroll to bottom
    panel.scrollTop = panel.scrollHeight;
  }

  function togglePanel() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return;

    _panelVisible = !_panelVisible;
    panel.style.display = _panelVisible ? 'block' : 'none';

    const toggle = document.getElementById('debug-toggle');
    toggle.style.background = _panelVisible ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 255, 0, 0.9)';
    toggle.textContent = _panelVisible ? '❌ CLOSE' : '🐛 DEBUG';
  }

  function clearLogs() {
    _logs = [];
    updatePanel();
  }

  function logRealtime(event, data) {
    addLog('REALTIME', `${event}: ${JSON.stringify(data).substring(0, 100)}`);
  }

  return {
    init,
    addLog,
    clearLogs,
    logRealtime,
    togglePanel
  };
})();

// Auto-initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => DebugPanel.init());
} else {
  DebugPanel.init();
}
