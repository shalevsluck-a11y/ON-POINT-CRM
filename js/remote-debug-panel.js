// Remote Debug Panel - PC viewer for iPhone debug events
// Shows real-time debug logs from iPhone app and service worker

const RemoteDebugPanel = {
  isAdmin: false,
  subscription: null,
  events: [],
  maxEvents: 100,

  async init() {
    // Check if user is admin
    const user = await this.getCurrentUser();
    if (!user) return;

    const { data: profile } = await window.supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    this.isAdmin = profile?.role === 'admin';

    if (!this.isAdmin) {
      // Hide debug panel for non-admins
      document.getElementById('remote-debug-panel')?.remove();
      document.getElementById('debug-toggle-btn')?.remove();
      return;
    }

    // Show toggle button
    const toggleBtn = document.getElementById('debug-toggle-btn');
    if (toggleBtn) toggleBtn.classList.remove('hidden');

    // Set up event filters
    document.getElementById('debug-filter-source')?.addEventListener('change', () => this.render());
    document.getElementById('debug-filter-type')?.addEventListener('change', () => this.render());

    // Load recent events
    await this.loadRecentEvents();

    // Subscribe to realtime updates
    this.subscribeToLogs();

    // Listen for service worker push events
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PUSH_RECEIVED' || event.data?.type === 'PUSH_ERROR') {
          this.addEvent({
            source: 'service_worker',
            event_type: event.data.type.toLowerCase(),
            message: event.data.type === 'PUSH_RECEIVED' ? 'Push received by service worker' : 'Push error in service worker',
            payload_json: event.data.data || event.data,
            error_json: event.data.error ? { message: event.data.error } : null,
            created_at: event.data.timestamp || new Date().toISOString(),
            device_id: RemoteDebug.deviceId,
            platform: 'ios'
          });
        }
      });
    }
  },

  async getCurrentUser() {
    try {
      const { data } = await window.supabaseClient.auth.getUser();
      return data?.user || null;
    } catch (e) {
      return null;
    }
  },

  async loadRecentEvents() {
    try {
      const { data, error } = await window.supabaseClient
        .from('remote_debug_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      this.events = (data || []).reverse();
      this.render();
    } catch (error) {
      console.error('[RemoteDebugPanel] Failed to load recent events:', error);
    }
  },

  subscribeToLogs() {
    this.subscription = window.supabaseClient
      .channel('remote_debug_logs')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'remote_debug_logs'
      }, (payload) => {
        this.addEvent(payload.new);
      })
      .subscribe();
  },

  addEvent(event) {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift(); // Remove oldest
    }
    this.render();

    // Auto-scroll to bottom
    const container = document.getElementById('debug-events');
    if (container) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 10);
    }
  },

  render() {
    const container = document.getElementById('debug-events');
    if (!container) return;

    const sourceFilter = document.getElementById('debug-filter-source')?.value || '';
    const typeFilter = document.getElementById('debug-filter-type')?.value || '';

    let filtered = this.events;

    if (sourceFilter) {
      filtered = filtered.filter(e => e.source === sourceFilter);
    }

    if (typeFilter) {
      if (typeFilter === 'error') {
        filtered = filtered.filter(e => e.event_type.includes('error') || e.error_json);
      } else {
        filtered = filtered.filter(e => e.event_type === typeFilter);
      }
    }

    // Update count
    const countEl = document.getElementById('debug-count');
    if (countEl) {
      countEl.textContent = `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px 20px;">No events match filters</div>';
      return;
    }

    container.innerHTML = filtered.map(event => this.renderEvent(event)).join('');
  },

  renderEvent(event) {
    const time = new Date(event.created_at).toLocaleTimeString('en-US', { hour12: false });
    const sourceColor = {
      'app': '#3b82f6',
      'service_worker': '#8b5cf6',
      'push_handler': '#ec4899',
      'system': '#64748b'
    }[event.source] || '#94a3b8';

    const isError = event.event_type.includes('error') || event.error_json;
    const bgColor = isError ? '#7f1d1d' : '#1e293b';
    const borderColor = isError ? '#dc2626' : '#334155';

    let payloadHtml = '';
    if (event.payload_json) {
      const payload = typeof event.payload_json === 'string'
        ? event.payload_json
        : JSON.stringify(event.payload_json, null, 2);
      payloadHtml = `
        <details style="margin-top:6px;">
          <summary style="color:#94a3b8;cursor:pointer;user-select:none;">📦 Payload</summary>
          <pre style="margin:6px 0 0;padding:8px;background:#0f172a;border-radius:4px;color:#cbd5e1;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${this.escapeHtml(payload)}</pre>
        </details>
      `;
    }

    let errorHtml = '';
    if (event.error_json) {
      const error = typeof event.error_json === 'string'
        ? event.error_json
        : JSON.stringify(event.error_json, null, 2);
      errorHtml = `
        <details open style="margin-top:6px;">
          <summary style="color:#fca5a5;cursor:pointer;user-select:none;">❌ Error</summary>
          <pre style="margin:6px 0 0;padding:8px;background:#450a0a;border-radius:4px;color:#fca5a5;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${this.escapeHtml(error)}</pre>
        </details>
      `;
    }

    return `
      <div style="margin-bottom:8px;padding:10px;background:${bgColor};border-left:3px solid ${borderColor};border-radius:6px;">
        <div style="display:flex;gap:8px;align-items:start;flex-wrap:wrap;">
          <span style="color:#64748b;font-size:10px;">${time}</span>
          <span style="padding:2px 6px;border-radius:4px;background:${sourceColor};color:#fff;font-size:10px;font-weight:600;white-space:nowrap;">${event.source}</span>
          <span style="color:#cbd5e1;font-weight:600;">${event.event_type}</span>
          <span style="color:#cbd5e1;flex:1;">${this.escapeHtml(event.message)}</span>
        </div>
        ${event.device_id ? `<div style="margin-top:4px;color:#64748b;font-size:10px;">📱 ${event.device_id}</div>` : ''}
        ${payloadHtml}
        ${errorHtml}
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  toggle() {
    const panel = document.getElementById('remote-debug-panel');
    if (panel) {
      panel.classList.toggle('hidden');
    }
  },

  clear() {
    this.events = [];
    this.render();
  },

  cleanup() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => RemoteDebugPanel.init(), 1000);
  });
} else {
  setTimeout(() => RemoteDebugPanel.init(), 1000);
}
