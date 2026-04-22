/* ============================================================
   REALTIME MANAGER - WhatsApp-level instant updates
   Features:
   - WebSocket health monitoring with heartbeat
   - Auto-reconnect with exponential backoff
   - Connection quality indicator
   - Presence system (who's online)
   - Change broadcasting
   ============================================================ */

const RealtimeManager = (() => {

  let _wsHealth = {
    connected: false,
    quality: 'unknown', // good, degraded, poor, offline
    latency: 0,
    lastPingTime: 0,
    reconnectAttempts: 0,
    lastSuccessfulConnect: null
  };

  let _heartbeatInterval = null;
  let _reconnectTimeout = null;
  let _presenceChannel = null;
  let _onlineUsers = new Set();
  let _statusCallbacks = [];

  // ──────────────────────────────────────────────────────────
  // INITIALIZATION
  // ──────────────────────────────────────────────────────────

  function init() {
    console.log('[RealtimeManager] Initializing...');
    _startHeartbeat();
    _setupPresence();
    _monitorConnection();
    _updateStatusUI();
  }

  // ──────────────────────────────────────────────────────────
  // HEARTBEAT - Keep connection alive, measure latency
  // ──────────────────────────────────────────────────────────

  function _startHeartbeat() {
    if (_heartbeatInterval) clearInterval(_heartbeatInterval);

    _heartbeatInterval = setInterval(async () => {
      const pingStart = Date.now();

      try {
        // Simple ping: query a tiny record
        const { error } = await SupabaseClient
          .from('app_settings')
          .select('id')
          .limit(1)
          .single();

        if (error) throw error;

        const latency = Date.now() - pingStart;
        _wsHealth.latency = latency;
        _wsHealth.connected = true;
        _wsHealth.lastPingTime = Date.now();
        _wsHealth.reconnectAttempts = 0;

        // Update quality based on latency
        if (latency < 100) {
          _wsHealth.quality = 'excellent';
        } else if (latency < 300) {
          _wsHealth.quality = 'good';
        } else if (latency < 1000) {
          _wsHealth.quality = 'degraded';
        } else {
          _wsHealth.quality = 'poor';
        }

        _updateStatusUI();

      } catch (error) {
        console.error('[RealtimeManager] Heartbeat failed:', error);
        _wsHealth.connected = false;
        _wsHealth.quality = 'offline';
        _attemptReconnect();
      }

    }, 15000); // Ping every 15 seconds
  }

  // ──────────────────────────────────────────────────────────
  // AUTO-RECONNECT with exponential backoff
  // ──────────────────────────────────────────────────────────

  function _attemptReconnect() {
    if (_reconnectTimeout) return; // Already reconnecting

    const backoffMs = Math.min(1000 * Math.pow(2, _wsHealth.reconnectAttempts), 30000);
    _wsHealth.reconnectAttempts++;

    console.log(`[RealtimeManager] Reconnecting in ${backoffMs}ms (attempt ${_wsHealth.reconnectAttempts})`);

    _reconnectTimeout = setTimeout(async () => {
      _reconnectTimeout = null;
      console.log('[RealtimeManager] Attempting reconnect...');

      try {
        // Test connection with a simple query
        const { error } = await SupabaseClient.from('app_settings').select('id').limit(1).single();

        if (!error) {
          console.log('[RealtimeManager] ✓ Reconnected successfully!');
          _wsHealth.connected = true;
          _wsHealth.quality = 'good';
          _wsHealth.reconnectAttempts = 0;
          _wsHealth.lastSuccessfulConnect = Date.now();
          _updateStatusUI();

          // Notify app to re-subscribe to channels
          if (window.App && window.App.onReconnect) {
            window.App.onReconnect();
          }
        } else {
          throw error;
        }
      } catch (error) {
        console.error('[RealtimeManager] Reconnect failed:', error);
        _attemptReconnect(); // Try again
      }
    }, backoffMs);
  }

  // ──────────────────────────────────────────────────────────
  // PRESENCE - Track who's online
  // ──────────────────────────────────────────────────────────

  function _setupPresence() {
    if (!Auth.getUser()) return;

    const user = Auth.getUser();
    _presenceChannel = SupabaseClient.channel('presence')
      .on('presence', { event: 'sync' }, () => {
        const state = _presenceChannel.presenceState();
        _onlineUsers.clear();

        Object.values(state).forEach(presences => {
          presences.forEach(presence => {
            _onlineUsers.add(presence.user_id);
          });
        });

        console.log('[RealtimeManager] Online users:', _onlineUsers.size);
        _updatePresenceUI();
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        newPresences.forEach(presence => {
          _onlineUsers.add(presence.user_id);
          console.log('[RealtimeManager] User joined:', presence.name);
        });
        _updatePresenceUI();
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        leftPresences.forEach(presence => {
          _onlineUsers.delete(presence.user_id);
          console.log('[RealtimeManager] User left:', presence.name);
        });
        _updatePresenceUI();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await _presenceChannel.track({
            user_id: user.id,
            name: user.name,
            role: user.role,
            online_at: new Date().toISOString()
          });
        }
      });
  }

  // ──────────────────────────────────────────────────────────
  // CONNECTION MONITORING
  // ──────────────────────────────────────────────────────────

  function _monitorConnection() {
    // Monitor online/offline events
    window.addEventListener('online', () => {
      console.log('[RealtimeManager] Browser back online');
      _wsHealth.connected = false; // Force reconnect check
      _attemptReconnect();
    });

    window.addEventListener('offline', () => {
      console.log('[RealtimeManager] Browser offline');
      _wsHealth.connected = false;
      _wsHealth.quality = 'offline';
      _updateStatusUI();
    });
  }

  // ──────────────────────────────────────────────────────────
  // UI UPDATES
  // ──────────────────────────────────────────────────────────

  function _updateStatusUI() {
    // Update connection indicator
    const indicator = document.getElementById('realtime-status');
    if (!indicator) return;

    const { quality, latency, connected } = _wsHealth;

    let color, icon, text;
    if (!connected || quality === 'offline') {
      color = '#EF4444'; // red
      icon = '○';
      text = 'Offline';
    } else if (quality === 'excellent' || quality === 'good') {
      color = '#10B981'; // green
      icon = '●';
      text = `${latency}ms`;
    } else if (quality === 'degraded') {
      color = '#F59E0B'; // yellow
      icon = '●';
      text = `${latency}ms`;
    } else {
      color = '#EF4444'; // red
      icon = '●';
      text = `${latency}ms`;
    }

    indicator.innerHTML = `
      <span style="color: ${color}; font-size: 12px; display: flex; align-items: center; gap: 4px;">
        <span style="font-size: 16px; line-height: 1;">${icon}</span>
        <span style="opacity: 0.8;">${text}</span>
      </span>
    `;
    indicator.title = `Connection: ${quality} (${latency}ms latency)`;

    // Notify callbacks
    _statusCallbacks.forEach(cb => cb(_wsHealth));
  }

  function _updatePresenceUI() {
    const container = document.getElementById('online-users');
    if (!container) return;

    const count = _onlineUsers.size;
    container.innerHTML = `
      <span style="color: var(--color-text-secondary); font-size: 13px;">
        <span style="color: #10B981;">●</span> ${count} online
      </span>
    `;
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────

  function onStatusChange(callback) {
    _statusCallbacks.push(callback);
  }

  function getStatus() {
    return { ..._wsHealth };
  }

  function getOnlineUsers() {
    return Array.from(_onlineUsers);
  }

  function forceReconnect() {
    console.log('[RealtimeManager] Manual reconnect triggered');
    _wsHealth.reconnectAttempts = 0;
    _attemptReconnect();
  }

  return {
    init,
    onStatusChange,
    getStatus,
    getOnlineUsers,
    forceReconnect
  };

})();

// Auto-initialize
if (typeof window !== 'undefined') {
  window.RealtimeManager = RealtimeManager;
}
